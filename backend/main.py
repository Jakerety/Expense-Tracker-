from __future__ import annotations

import os
import hashlib
import logging
import re
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from postgrest.exceptions import APIError
from backend.admin import router as admin_router
from backend.categorization import infer_transaction_type, suggest_category_id
from backend.security import Auth, AuthenticatedClient
from backend.support import router as support_router


class TransactionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: UUID | None = None
    transaction_type: Literal["income", "expense"]
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    currency: str = Field(pattern=r"^[A-Z]{3}$", default="NGN")
    description: str = Field(default="", max_length=240)
    transaction_date: date


class TransactionImportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    transactions: list[TransactionInput] = Field(min_length=1, max_length=500)


class TransactionCategoryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: UUID | None


class BudgetInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: UUID | None = None
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    currency: str = Field(pattern=r"^[A-Z]{3}$", default="NGN")
    start_date: date


class OrganizationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=120)
    currency: str = Field(pattern=r"^[A-Z]{3}$", default="NGN")


class ProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, max_length=120)
    preferred_currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")


app = FastAPI(title="Expense Tracker API", version="1.0.0")
logger = logging.getLogger(__name__)
allowed_origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(admin_router)
app.include_router(support_router)


def workspace_filter(query, workspace_id: str, user_id: str):
    if workspace_id == "personal":
        return query.is_("organization_id", "null").eq("user_id", user_id)
    try:
        UUID(workspace_id)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="workspace_id must be 'personal' or an organization UUID") from error
    return query.eq("organization_id", workspace_id)


def transaction_values(payload: TransactionInput, auth: AuthenticatedClient, workspace_id: str) -> dict:
    values = payload.model_dump(mode="json")
    values["user_id"] = auth.user_id
    values["organization_id"] = None if workspace_id == "personal" else workspace_id
    return values


def transaction_fingerprint(payload: TransactionInput, auth: AuthenticatedClient, workspace_id: str) -> str:
    scope = workspace_id if workspace_id != "personal" else auth.user_id
    return _make_transaction_fingerprint(
        scope,
        payload.transaction_date.isoformat(),
        payload.transaction_type,
        payload.amount,
        payload.currency,
        payload.description,
    )


def _make_transaction_fingerprint(
    scope: str,
    transaction_date: str,
    transaction_type: str,
    amount: Decimal | str,
    currency: str,
    description: str,
) -> str:
    normalized_description = re.sub(r"\s+", " ", description).strip().lower()
    normalized_amount = Decimal(str(amount)).quantize(Decimal("0.01"))
    fingerprint_parts = (
        scope,
        transaction_date,
        transaction_type,
        format(normalized_amount, ".2f"),
        currency,
        normalized_description,
    )
    return hashlib.sha256("|".join(fingerprint_parts).encode("utf-8")).hexdigest()


def _workspace_categories(auth: AuthenticatedClient, workspace_id: str) -> list[dict]:
    return workspace_filter(
        auth.client.table("categories").select("*"),
        workspace_id,
        auth.user_id,
    ).order("name").execute().data


def _validate_import_categories(transactions: list[TransactionInput], categories: list[dict]) -> None:
    categories_by_id = {str(category["id"]): category for category in categories}
    for transaction in transactions:
        if transaction.category_id is None:
            continue
        category = categories_by_id.get(str(transaction.category_id))
        if not category or category.get("category_type") not in (transaction.transaction_type, "both"):
            raise HTTPException(status_code=422, detail="A selected category is not available for this transaction in this workspace.")


def _fingerprints_already_saved(
    auth: AuthenticatedClient,
    workspace_id: str,
    transactions: list[TransactionInput],
) -> set[str]:
    if not transactions:
        return set()
    dates = sorted({transaction.transaction_date.isoformat() for transaction in transactions})
    query = workspace_filter(
        auth.client.table("transactions").select(
            "fingerprint,transaction_date,transaction_type,amount,currency,description",
        ),
        workspace_id,
        auth.user_id,
    )
    rows = query.in_("transaction_date", dates).execute().data
    scope = workspace_id if workspace_id != "personal" else auth.user_id
    return {
        row.get("fingerprint") or _make_transaction_fingerprint(
            scope,
            str(row["transaction_date"]),
            row["transaction_type"],
            row["amount"],
            row["currency"],
            row["description"],
        )
        for row in rows
    }


def _raise_import_database_error(error: APIError) -> None:
    logger.exception("Statement import database request failed (code=%s)", error.code)
    if error.code == "42703":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Statement-import database migration is required. Apply supabase/migrations/20261008110000_transaction_import_fingerprint.sql and retry.",
        ) from error
    if error.code in ("23503", "23514", "P0001"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A selected category is not available for this workspace.",
        ) from error
    if error.code == "42501":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to import transactions into this workspace.",
        ) from error
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="The statement import could not be saved. Check the API logs for details.",
    ) from error


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/debug/auth")
def debug_auth(auth: Auth) -> dict:
    result = (
        auth.client.rpc("debug_auth_uid")
        .execute()
    )

    return {
        "backend_user_id": auth.user_id,
        "database_auth_uid": result.data,
    }


@app.get("/api/bootstrap")
def bootstrap(auth: Auth) -> dict:
    profile_result = auth.client.table("profiles").select("*").eq("id", auth.user_id).maybe_single().execute()
    profile = profile_result.data if profile_result is not None else None
    memberships = auth.client.table("organization_members").select("organization_id,role,created_at,organizations(id,name,currency)").eq("user_id", auth.user_id).order("created_at", desc=True).execute().data
    categories = auth.client.table("categories").select("*").execute().data
    transactions = auth.client.table("transactions").select("*").order("transaction_date", desc=True).limit(1000).execute().data
    budgets = auth.client.table("budgets").select("*").execute().data
    default_workspace_id = "personal"
    if auth.user_metadata.get("workspace_type") == "organization" and memberships:
        default_workspace_id = memberships[0]["organization_id"]
    return {
        "profile": profile,
        "email": auth.email,
        "default_workspace_id": default_workspace_id,
        "organizations": memberships,
        "categories": categories,
        "transactions": transactions,
        "budgets": budgets,
    }


@app.get("/api/transactions")
def list_transactions(
    auth: Auth,
    workspace_id: Annotated[str, Query(min_length=1)],
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict]:
    query = workspace_filter(auth.client.table("transactions").select("*"), workspace_id, auth.user_id)
    if date_from:
        query = query.gte("transaction_date", date_from.isoformat())
    if date_to:
        query = query.lte("transaction_date", date_to.isoformat())
    return query.order("transaction_date", desc=True).limit(1000).execute().data


@app.get("/api/categories")
def list_categories(auth: Auth, workspace_id: Annotated[str, Query(min_length=1)]) -> list[dict]:
    query = workspace_filter(auth.client.table("categories").select("*"), workspace_id, auth.user_id)
    return query.order("name").execute().data


@app.post("/api/transactions/categorize-uncategorized")
def categorize_uncategorized_transactions(
    auth: Auth,
    workspace_id: Annotated[str, Query(min_length=1)],
) -> list[dict]:
    categories = _workspace_categories(auth, workspace_id)
    query = workspace_filter(
        auth.client.table("transactions")
        .select("id,user_id,description,transaction_type")
        .is_("category_id", "null"),
        workspace_id,
        auth.user_id,
    )
    rows = query.limit(1000).execute().data

    can_manage_workspace = workspace_id == "personal"
    if workspace_id != "personal":
        membership = (
            auth.client.table("organization_members")
            .select("role")
            .eq("organization_id", workspace_id)
            .eq("user_id", auth.user_id)
            .maybe_single()
            .execute()
            .data
        )
        can_manage_workspace = bool(membership and membership.get("role") in ("owner", "admin"))

    rows_by_assignment: dict[tuple[str, str], list[str]] = {}
    for row in rows:
        if not can_manage_workspace and row["user_id"] != auth.user_id:
            continue
        transaction_type = infer_transaction_type(row["description"], row["transaction_type"])
        category_id = suggest_category_id(row["description"], transaction_type, categories)
        if category_id:
            rows_by_assignment.setdefault((category_id, transaction_type), []).append(row["id"])

    updated: list[dict] = []
    for (category_id, transaction_type), transaction_ids in rows_by_assignment.items():
        update_query = workspace_filter(
            auth.client.table("transactions").update({
                "category_id": category_id,
                "transaction_type": transaction_type,
            }),
            workspace_id,
            auth.user_id,
        )
        updated.extend(update_query.in_("id", transaction_ids).execute().data or [])
    return updated


@app.post("/api/transactions", status_code=status.HTTP_201_CREATED)
def create_transaction(payload: TransactionInput, auth: Auth, workspace_id: Annotated[str, Query(min_length=1)]) -> dict:
    values = transaction_values(payload, auth, workspace_id)
    return auth.client.table("transactions").insert(values).execute().data[0]


@app.post("/api/transactions/import", status_code=status.HTTP_201_CREATED)
def import_transactions(payload: TransactionImportInput, auth: Auth, workspace_id: Annotated[str, Query(min_length=1)]) -> dict:
    categories = _workspace_categories(auth, workspace_id)
    _validate_import_categories(payload.transactions, categories)
    values = []
    for transaction in payload.transactions:
        transaction_value = transaction_values(transaction, auth, workspace_id)
        if transaction.category_id is None:
            transaction_value["category_id"] = suggest_category_id(
                transaction.description,
                transaction.transaction_type,
                categories,
            )
        transaction_value["fingerprint"] = transaction_fingerprint(transaction, auth, workspace_id)
        values.append(transaction_value)

    try:
        existing_fingerprints = _fingerprints_already_saved(auth, workspace_id, payload.transactions)
        new_values = [value for value in values if value["fingerprint"] not in existing_fingerprints]
        inserted = (
            auth.client.table("transactions")
            .upsert(new_values, on_conflict="fingerprint", ignore_duplicates=True)
            .execute()
            .data
            if new_values
            else []
        )
    except APIError as error:
        _raise_import_database_error(error)

    inserted = inserted or []
    categorized = sum(1 for transaction in inserted if transaction.get("category_id"))
    return {
        "total": len(payload.transactions),
        "new": len(inserted),
        "duplicates": len(payload.transactions) - len(inserted),
        "categorized": categorized,
        "uncategorized": len(inserted) - categorized,
        "transactions": inserted,
    }


@app.post("/api/transactions/import/preview")
def preview_transaction_import(
    payload: TransactionImportInput,
    auth: Auth,
    workspace_id: Annotated[str, Query(min_length=1)],
) -> dict:
    categories = _workspace_categories(auth, workspace_id)
    _validate_import_categories(payload.transactions, categories)
    fingerprints = [transaction_fingerprint(transaction, auth, workspace_id) for transaction in payload.transactions]
    try:
        existing_fingerprints = _fingerprints_already_saved(auth, workspace_id, payload.transactions)
    except APIError as error:
        _raise_import_database_error(error)

    seen: set[str] = set()
    rows = []
    for transaction, fingerprint in zip(payload.transactions, fingerprints, strict=True):
        is_duplicate = fingerprint in existing_fingerprints or fingerprint in seen
        seen.add(fingerprint)
        category_id = str(transaction.category_id) if transaction.category_id else None
        auto_categorized = False
        if category_id is None:
            category_id = suggest_category_id(transaction.description, transaction.transaction_type, categories)
            auto_categorized = category_id is not None
        row = transaction.model_dump(mode="json")
        row["category_id"] = category_id
        row["is_duplicate"] = is_duplicate
        row["auto_categorized"] = auto_categorized
        rows.append(row)

    duplicates = sum(1 for row in rows if row["is_duplicate"])
    return {
        "total": len(rows),
        "new": len(rows) - duplicates,
        "duplicates": duplicates,
        "transactions": rows,
    }


@app.patch("/api/transactions/{transaction_id}")
def update_transaction(transaction_id: UUID, payload: TransactionInput, auth: Auth) -> dict:
    values = payload.model_dump(mode="json")
    result = auth.client.table("transactions").update(values).eq("id", str(transaction_id)).execute().data
    if not result:
        raise HTTPException(status_code=404, detail="Transaction not found or not editable")
    return result[0]


@app.patch("/api/transactions/{transaction_id}/category")
def update_transaction_category(
    transaction_id: UUID,
    payload: TransactionCategoryInput,
    auth: Auth,
) -> dict:
    result = (
        auth.client.table("transactions")
        .update({"category_id": str(payload.category_id) if payload.category_id else None})
        .eq("id", str(transaction_id))
        .execute()
        .data
    )
    if not result:
        raise HTTPException(status_code=404, detail="Transaction not found or not editable")
    return result[0]


@app.delete("/api/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(transaction_id: UUID, auth: Auth) -> Response:
    result = auth.client.table("transactions").delete().eq("id", str(transaction_id)).execute().data
    if not result:
        raise HTTPException(status_code=404, detail="Transaction not found or not editable")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/budgets")
def list_budgets(auth: Auth, workspace_id: Annotated[str, Query(min_length=1)]) -> list[dict]:
    query = workspace_filter(auth.client.table("budgets").select("*"), workspace_id, auth.user_id)
    return query.order("start_date", desc=True).execute().data


@app.post("/api/budgets", status_code=status.HTTP_201_CREATED)
def create_budget(payload: BudgetInput, auth: Auth, workspace_id: Annotated[str, Query(min_length=1)]) -> dict:
    values = payload.model_dump(mode="json")
    values["user_id"] = auth.user_id
    values["organization_id"] = None if workspace_id == "personal" else workspace_id
    return auth.client.table("budgets").insert(values).execute().data[0]


@app.get("/api/organizations")
def list_organizations(auth: Auth) -> list[dict]:
    return auth.client.table("organization_members").select("role,organization:organizations(*)").eq("user_id", auth.user_id).execute().data


@app.post("/api/organizations", status_code=status.HTTP_201_CREATED)
def create_organization(payload: OrganizationInput, auth: Auth) -> dict:
    return (
        auth.client.rpc(
            "create_organization",
            {
                "organization_name": payload.name,
                "organization_currency": payload.currency,
            },
        )
        .execute()
        .data[0]
    )


@app.get("/api/profile")
def get_profile(auth: Auth) -> dict:
    result = auth.client.table("profiles").select("*").eq("id", auth.user_id).single().execute().data
    return result


@app.patch("/api/profile")
def update_profile(payload: ProfileInput, auth: Auth) -> dict:
    values = payload.model_dump(exclude_unset=True)
    result = auth.client.table("profiles").update(values).eq("id", auth.user_id).execute().data
    if not result:
        raise HTTPException(status_code=404, detail="Profile not found")
    return result[0]