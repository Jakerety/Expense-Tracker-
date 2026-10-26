import logging
import os
from decimal import Decimal
from typing import Literal, NoReturn
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict, Field
from supabase import Client, create_client
from supabase_auth.errors import AuthApiError

from backend.security import Auth, require_workspace_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])
logger = logging.getLogger(__name__)


class OrganizationMemberInviteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=254)
    role: Literal["admin", "member"] = "member"


class OrganizationMemberRoleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["admin", "member"]


def _service_client() -> Client:
    supabase_url = os.getenv("SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Member invitations require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the backend environment. "
                "Set them in the project-root .env file using values from the same Supabase project, then restart the API. "
                "Never use a VITE_ variable for the service-role key."
            ),
        )
    return create_client(supabase_url, service_role_key)


def _raise_admin_migration_error(error: APIError) -> NoReturn:
    if error.code == "42883":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Organization member management database migration is required. Apply supabase/migrations/20261009140000_admin_member_management.sql.",
        ) from error
    logger.exception("Organization member management database request failed (code=%s)", error.code)
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="The database could not complete this member-management request.",
    ) from error


@router.get("/overview")
def get_admin_overview(organization_id: UUID, auth: Auth) -> dict:
    require_workspace_admin(auth, organization_id)
    organization_key = str(organization_id)
    transactions = (
        auth.client.table("transactions")
        .select("id,transaction_type,amount,currency,description,transaction_date,user_id")
        .eq("organization_id", organization_key)
        .order("transaction_date", desc=True)
        .limit(1000)
        .execute()
        .data
    )
    budgets = auth.client.table("budgets").select("id,amount").eq("organization_id", organization_key).execute().data
    members = auth.client.table("organization_members").select("id,role").eq("organization_id", organization_key).execute().data
    income = sum((Decimal(str(row["amount"])) for row in transactions if row["transaction_type"] == "income"), Decimal(0))
    expenses = sum((Decimal(str(row["amount"])) for row in transactions if row["transaction_type"] == "expense"), Decimal(0))
    return {
        "member_count": len(members),
        "transaction_count": len(transactions),
        "budget_count": len(budgets),
        "income": str(income),
        "expenses": str(expenses),
        "net": str(income - expenses),
        "recent_transactions": transactions[:8],
    }


@router.get("/members")
def list_organization_members(organization_id: UUID, auth: Auth) -> list[dict]:
    require_workspace_admin(auth, organization_id)
    try:
        return auth.client.rpc(
            "list_organization_members",
            {"target_organization_id": str(organization_id)},
        ).execute().data
    except APIError as error:
        _raise_admin_migration_error(error)


@router.post("/members", status_code=status.HTTP_201_CREATED)
def invite_organization_member(
    organization_id: UUID,
    payload: OrganizationMemberInviteInput,
    auth: Auth,
) -> dict:
    requester_role = require_workspace_admin(auth, organization_id)
    if requester_role != "owner" and payload.role != "member":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the workspace owner can invite an admin.",
        )

    service_client = _service_client()
    invite_redirect_url = os.getenv("SUPABASE_AUTH_REDIRECT_URL")
    try:
        invite_options = {"redirect_to": invite_redirect_url} if invite_redirect_url else None
        invite = service_client.auth.admin.invite_user_by_email(payload.email, invite_options)
    except AuthApiError as error:
        if error.code in ("email_exists", "user_already_exists"):
            try:
                member = auth.client.rpc(
                    "add_organization_member_by_email",
                    {
                        "target_organization_id": str(organization_id),
                        "member_email": payload.email,
                        "member_role": payload.role,
                    },
                ).execute().data
            except APIError as membership_error:
                if membership_error.code == "23505":
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="This user is already a member of the organization.",
                    ) from membership_error
                if membership_error.code == "P0002":
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="No account exists for this email address.",
                    ) from membership_error
                _raise_admin_migration_error(membership_error)
            if not member:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="The existing account was found, but no workspace membership was created.",
                )
            return member[0]
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase could not send the invitation: {error.message}",
        ) from error

    if not invite.user:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Supabase accepted the invitation request but returned no user.",
        )

    try:
        member = (
            service_client.table("organization_members")
            .insert({
                "organization_id": str(organization_id),
                "user_id": str(invite.user.id),
                "role": payload.role,
            })
            .execute()
            .data
        )
    except APIError as error:
        logger.exception("Invitation was sent but organization membership creation failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The invitation email was sent, but workspace membership could not be created. Contact support before inviting this email again.",
        ) from error

    if not member:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The invitation email was sent, but no workspace membership was created.",
        )
    return {
        "user_id": str(invite.user.id),
        "email": payload.email,
        "role": payload.role,
        "created_at": member[0]["created_at"],
        "invitation_sent": True,
    }


@router.patch("/members/{user_id}")
def update_organization_member_role(
    user_id: UUID,
    organization_id: UUID,
    payload: OrganizationMemberRoleInput,
    auth: Auth,
) -> dict:
    requester_role = require_workspace_admin(auth, organization_id)
    if str(user_id) == auth.user_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You cannot change your own workspace role.")
    if requester_role != "owner" and payload.role == "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the workspace owner can promote a member to admin.",
        )

    target_result = (
        auth.client.table("organization_members")
        .select("role")
        .eq("organization_id", str(organization_id))
        .eq("user_id", str(user_id))
        .maybe_single()
        .execute()
    )
    target = target_result.data if target_result is not None else None
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace member not found.")
    if target["role"] == "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="The workspace owner role cannot be changed here.")
    if requester_role != "owner" and target["role"] == "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the workspace owner can manage another admin.")

    result = (
        auth.client.table("organization_members")
        .update({"role": payload.role})
        .eq("organization_id", str(organization_id))
        .eq("user_id", str(user_id))
        .execute()
        .data
    )
    if not result:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Workspace role could not be updated.")
    return result[0]


@router.delete("/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_organization_member(user_id: UUID, organization_id: UUID, auth: Auth) -> None:
    requester_role = require_workspace_admin(auth, organization_id)
    if str(user_id) == auth.user_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You cannot remove yourself from this workspace.")

    target_result = (
        auth.client.table("organization_members")
        .select("role")
        .eq("organization_id", str(organization_id))
        .eq("user_id", str(user_id))
        .maybe_single()
        .execute()
    )
    target = target_result.data if target_result is not None else None
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace member not found.")
    if target["role"] == "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="The workspace owner cannot be removed.")
    if requester_role != "owner" and target["role"] == "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the workspace owner can remove another admin.")

    result = (
        auth.client.table("organization_members")
        .delete()
        .eq("organization_id", str(organization_id))
        .eq("user_id", str(user_id))
        .execute()
        .data
    )
    if not result:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Workspace member could not be removed.")