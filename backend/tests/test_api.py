from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.categorization import infer_transaction_type, suggest_category_id
from backend.admin import (
    OrganizationMemberInviteInput,
    OrganizationMemberRoleInput,
    invite_organization_member,
    remove_organization_member,
    update_organization_member_role,
)
from backend.main import (
    OrganizationInput,
    TransactionCategoryInput,
    TransactionImportInput,
    TransactionInput,
    app,
    bootstrap,
    create_organization,
    import_transactions,
    categorize_uncategorized_transactions,
    preview_transaction_import,
    transaction_fingerprint,
    update_transaction_category,
)
from backend.security import get_authenticated_client, require_platform_admin, require_workspace_admin
from backend.support import TicketStatusInput, get_support_admin_access, list_support_inbox_tickets, update_ticket_status

client = TestClient(app)


def make_auth(table_results: dict[str, object] | None = None) -> SimpleNamespace:
    results = table_results or {}
    database = MagicMock()

    def table_query(table_name: str) -> MagicMock:
        query = MagicMock()
        query.select.return_value = query
        query.eq.return_value = query
        query.maybe_single.return_value = query
        query.order.return_value = query
        query.limit.return_value = query
        query.execute.return_value = results.get(table_name)
        return query

    database.table.side_effect = table_query
    return SimpleNamespace(
        client=database,
        user_id="11111111-1111-4111-8111-111111111111",
        email="user@example.com",
        user_metadata={},
    )


def test_health_check_is_public() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_debug_auth_returns_backend_and_database_user_ids() -> None:
    auth = make_auth()
    auth.client.rpc.return_value.execute.return_value.data = "11111111-1111-4111-8111-111111111111"
    app.dependency_overrides[get_authenticated_client] = lambda: auth

    try:
        response = client.get("/api/debug/auth")
    finally:
        app.dependency_overrides.pop(get_authenticated_client, None)

    assert response.status_code == 200
    assert response.json() == {
        "backend_user_id": auth.user_id,
        "database_auth_uid": auth.user_id,
    }
    auth.client.rpc.assert_called_once_with("debug_auth_uid")


def test_financial_endpoints_require_supabase_session() -> None:
    response = client.get("/api/transactions", params={"workspace_id": "personal"})
    assert response.status_code == 401
    assert response.json()["detail"] == "A Supabase access token is required"


def test_category_list_requires_supabase_session() -> None:
    response = client.get("/api/categories", params={"workspace_id": "personal"})
    assert response.status_code == 401


def test_authenticated_client_sets_validated_token_for_database_queries(monkeypatch: pytest.MonkeyPatch) -> None:
    token = "test-access-token"
    user = SimpleNamespace(
        id="11111111-1111-4111-8111-111111111111",
        email="user@example.com",
        user_metadata={},
    )
    database_client = SimpleNamespace(
        auth=SimpleNamespace(get_user=lambda _: SimpleNamespace(user=user)),
        postgrest=MagicMock(),
    )
    create_client = MagicMock(return_value=database_client)
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "test-anon-key")
    monkeypatch.setattr("backend.security.create_client", create_client)

    authenticated = get_authenticated_client(f"Bearer {token}")

    create_client.assert_called_once()
    database_client.postgrest.auth.assert_called_once_with(token)
    assert authenticated.user_id == user.id


def test_statement_import_requires_supabase_session() -> None:
    response = client.post(
        "/api/transactions/import",
        params={"workspace_id": "personal"},
        json={"transactions": []},
    )
    assert response.status_code == 401


def test_statement_import_accepts_uncategorized_transactions() -> None:
    transaction = TransactionInput.model_validate(
        {
            "category_id": None,
            "transaction_type": "expense",
            "amount": "1250.00",
            "currency": "NGN",
            "description": "Bank charge",
            "transaction_date": "2026-09-01",
        }
    )
    assert transaction.category_id is None


def test_transaction_fingerprint_normalizes_description_and_scopes_workspace() -> None:
    transaction = TransactionInput.model_validate({
        "category_id": None,
        "transaction_type": "expense",
        "amount": "1250.00",
        "currency": "NGN",
        "description": "  UBER   TRIP ",
        "transaction_date": "2026-09-01",
    })
    normalized = TransactionInput.model_validate({
        **transaction.model_dump(mode="json"),
        "description": "uber trip",
    })
    auth = make_auth()

    assert transaction_fingerprint(transaction, auth, "personal") == transaction_fingerprint(normalized, auth, "personal")
    assert transaction_fingerprint(transaction, auth, "personal") != transaction_fingerprint(transaction, auth, "22222222-2222-4222-8222-222222222222")


def test_import_ignores_database_duplicates_and_reports_counts() -> None:
    auth = make_auth()
    category_query = MagicMock()
    category_query.select.return_value = category_query
    category_query.is_.return_value = category_query
    category_query.eq.return_value = category_query
    category_query.order.return_value = category_query
    category_query.execute.return_value.data = [
        {"id": "44444444-4444-4444-8444-444444444444", "name": "Transportation", "category_type": "expense"},
    ]
    existing_query = MagicMock()
    existing_query.select.return_value = existing_query
    existing_query.is_.return_value = existing_query
    existing_query.eq.return_value = existing_query
    existing_query.in_.return_value = existing_query
    existing_query.execute.return_value.data = []
    transaction_query = MagicMock()
    transaction_query.upsert.return_value.execute.return_value.data = [
        {"id": "55555555-5555-4555-8555-555555555555", "category_id": "44444444-4444-4444-8444-444444444444"},
    ]
    auth.client.table.side_effect = [category_query, existing_query, transaction_query]
    payload = TransactionImportInput.model_validate({
        "transactions": [
            {
                "category_id": "44444444-4444-4444-8444-444444444444",
                "transaction_type": "expense",
                "amount": "4500.00",
                "currency": "NGN",
                "description": "UBER",
                "transaction_date": "2026-09-01",
            },
            {
                "category_id": "44444444-4444-4444-8444-444444444444",
                "transaction_type": "expense",
                "amount": "4500.00",
                "currency": "NGN",
                "description": " UBER ",
                "transaction_date": "2026-09-01",
            },
        ],
    })

    result = import_transactions(payload, auth, "personal")

    assert result == {
        "total": 2,
        "new": 1,
        "duplicates": 1,
        "categorized": 1,
        "uncategorized": 0,
        "transactions": transaction_query.upsert.return_value.execute.return_value.data,
    }
    transaction_query.upsert.assert_called_once()
    assert transaction_query.upsert.call_args.kwargs == {
        "on_conflict": "fingerprint",
        "ignore_duplicates": True,
    }


def test_import_skips_a_previously_saved_transaction_without_upserting() -> None:
    auth = make_auth()
    transaction = TransactionInput.model_validate({
        "transaction_type": "expense",
        "amount": "2000.00",
        "currency": "NGN",
        "description": "MTN data",
        "transaction_date": "2026-09-03",
    })
    category_query = MagicMock()
    category_query.select.return_value = category_query
    category_query.is_.return_value = category_query
    category_query.eq.return_value = category_query
    category_query.order.return_value = category_query
    category_query.execute.return_value.data = []
    existing_query = MagicMock()
    existing_query.select.return_value = existing_query
    existing_query.is_.return_value = existing_query
    existing_query.eq.return_value = existing_query
    existing_query.in_.return_value = existing_query
    existing_query.execute.return_value.data = [{
        "fingerprint": None,
        "transaction_date": "2026-09-03",
        "transaction_type": "expense",
        "amount": "2000.00",
        "currency": "NGN",
        "description": " mtn  data ",
    }]
    transaction_query = MagicMock()
    auth.client.table.side_effect = [category_query, existing_query, transaction_query]

    result = import_transactions(TransactionImportInput(transactions=[transaction]), auth, "personal")

    assert result["total"] == 1
    assert result["new"] == 0
    assert result["duplicates"] == 1
    assert result["transactions"] == []
    transaction_query.upsert.assert_not_called()


def test_import_preview_marks_saved_and_repeated_rows_and_suggests_real_categories() -> None:
    auth = make_auth()
    category_query = MagicMock()
    category_query.select.return_value = category_query
    category_query.is_.return_value = category_query
    category_query.eq.return_value = category_query
    category_query.order.return_value = category_query
    category_query.execute.return_value.data = [
        {"id": "44444444-4444-4444-8444-444444444444", "name": "Transportation", "category_type": "expense"},
    ]
    transaction_query = MagicMock()
    transaction_query.select.return_value = transaction_query
    transaction_query.is_.return_value = transaction_query
    transaction_query.eq.return_value = transaction_query
    transaction_query.in_.return_value = transaction_query
    auth.client.table.side_effect = lambda name: category_query if name == "categories" else transaction_query
    payload = TransactionImportInput.model_validate({
        "transactions": [
            {
                "transaction_type": "expense",
                "amount": "4500.00",
                "currency": "NGN",
                "description": "UBER trip",
                "transaction_date": "2026-09-01",
            },
            {
                "transaction_type": "expense",
                "amount": "4500.00",
                "currency": "NGN",
                "description": "uber trip",
                "transaction_date": "2026-09-01",
            },
        ],
    })
    transaction_query.in_.return_value.execute.return_value.data = [{
        "fingerprint": None,
        "transaction_date": "2026-09-01",
        "transaction_type": "expense",
        "amount": "4500.00",
        "currency": "NGN",
        "description": "  UBER   trip ",
    }]

    result = preview_transaction_import(payload, auth, "personal")

    assert result["new"] == 0
    assert result["duplicates"] == 2
    assert all(row["is_duplicate"] for row in result["transactions"])
    assert all(row["category_id"] == "44444444-4444-4444-8444-444444444444" for row in result["transactions"])
    assert all(row["auto_categorized"] for row in result["transactions"])


def test_category_suggestion_does_not_invent_missing_category() -> None:
    categories = [
        {"id": "44444444-4444-4444-8444-444444444444", "name": "Transportation", "category_type": "expense"},
    ]

    assert suggest_category_id("UBER trip", "expense", categories) == "44444444-4444-4444-8444-444444444444"
    assert suggest_category_id("Unknown merchant", "expense", categories) is None
    assert suggest_category_id("UBER refund", "income", categories) is None


def test_category_suggestion_supports_organization_workspace_category_names() -> None:
    categories = [
        {"id": "44444444-4444-4444-8444-444444444444", "name": "Meals & groceries", "category_type": "expense"},
        {"id": "55555555-5555-4555-8555-555555555555", "name": "Utilities", "category_type": "expense"},
        {"id": "66666666-6666-4666-8666-666666666666", "name": "Client Revenue", "category_type": "income"},
    ]

    assert suggest_category_id("Shoprite Lekki", "expense", categories) == "44444444-4444-4444-8444-444444444444"
    assert suggest_category_id("MTN Airtime", "expense", categories) == "55555555-5555-4555-8555-555555555555"
    assert suggest_category_id("Salary payment", "income", categories) == "66666666-6666-4666-8666-666666666666"


def test_category_suggestion_uses_workspace_fallback_for_unmatched_rows() -> None:
    categories = [
        {"id": "44444444-4444-4444-8444-444444444444", "name": "Other expenses", "category_type": "expense"},
        {"id": "55555555-5555-4555-8555-555555555555", "name": "Other income", "category_type": "income"},
    ]

    assert suggest_category_id("Unknown card merchant", "expense", categories) == "44444444-4444-4444-8444-444444444444"
    assert suggest_category_id("Unknown credit", "income", categories) == "55555555-5555-4555-8555-555555555555"


def test_income_description_corrects_legacy_expense_type() -> None:
    assert infer_transaction_type("Salary payment - Example Works Ltd", "expense") == "income"
    assert infer_transaction_type("Refund - Online marketplace", "expense") == "income"
    assert infer_transaction_type("Monthly account maintenance fee", "expense") == "expense"


def test_backfill_categorizes_existing_uncategorized_transactions() -> None:
    auth = make_auth()
    category_query = MagicMock()
    category_query.select.return_value = category_query
    category_query.is_.return_value = category_query
    category_query.eq.return_value = category_query
    category_query.order.return_value = category_query
    category_query.execute.return_value.data = [
        {"id": "44444444-4444-4444-8444-444444444444", "name": "Other expenses", "category_type": "expense"},
        {"id": "55555555-5555-4555-8555-555555555555", "name": "Other income", "category_type": "income"},
    ]
    candidate_query = MagicMock()
    candidate_query.select.return_value = candidate_query
    candidate_query.is_.return_value = candidate_query
    candidate_query.eq.return_value = candidate_query
    candidate_query.limit.return_value = candidate_query
    candidate_query.execute.return_value.data = [
        {
            "id": "66666666-6666-4666-8666-666666666666",
            "user_id": auth.user_id,
            "description": "Salary payment - Example Works Ltd",
            "transaction_type": "expense",
        },
        {
            "id": "77777777-7777-4777-8777-777777777777",
            "user_id": auth.user_id,
            "description": "Monthly account maintenance fee",
            "transaction_type": "expense",
        },
    ]
    income_update_query = MagicMock()
    income_update_query.update.return_value = income_update_query
    income_update_query.is_.return_value = income_update_query
    income_update_query.eq.return_value = income_update_query
    income_update_query.in_.return_value = income_update_query
    income_update_query.execute.return_value.data = [
        {
            "id": "66666666-6666-4666-8666-666666666666",
            "transaction_type": "income",
            "category_id": "55555555-5555-4555-8555-555555555555",
        },
    ]
    expense_update_query = MagicMock()
    expense_update_query.update.return_value = expense_update_query
    expense_update_query.is_.return_value = expense_update_query
    expense_update_query.eq.return_value = expense_update_query
    expense_update_query.in_.return_value = expense_update_query
    expense_update_query.execute.return_value.data = [
        {
            "id": "77777777-7777-4777-8777-777777777777",
            "transaction_type": "expense",
            "category_id": "44444444-4444-4444-8444-444444444444",
        },
    ]
    auth.client.table.side_effect = [category_query, candidate_query, income_update_query, expense_update_query]

    updated = categorize_uncategorized_transactions(auth, "personal")

    assert len(updated) == 2
    income_update_query.update.assert_called_once_with({
        "category_id": "55555555-5555-4555-8555-555555555555",
        "transaction_type": "income",
    })
    expense_update_query.update.assert_called_once_with({
        "category_id": "44444444-4444-4444-8444-444444444444",
        "transaction_type": "expense",
    })


def test_import_categorizes_rows_even_when_preview_was_skipped() -> None:
    auth = make_auth()
    category_query = MagicMock()
    category_query.select.return_value = category_query
    category_query.is_.return_value = category_query
    category_query.eq.return_value = category_query
    category_query.order.return_value = category_query
    category_query.execute.return_value.data = [
        {"id": "44444444-4444-4444-8444-444444444444", "name": "Transportation", "category_type": "expense"},
        {"id": "55555555-5555-4555-8555-555555555555", "name": "Other expenses", "category_type": "expense"},
    ]
    existing_query = MagicMock()
    existing_query.select.return_value = existing_query
    existing_query.is_.return_value = existing_query
    existing_query.eq.return_value = existing_query
    existing_query.in_.return_value = existing_query
    existing_query.execute.return_value.data = []
    transaction_query = MagicMock()
    transaction_query.upsert.return_value.execute.return_value.data = [
        {"id": "66666666-6666-4666-8666-666666666666", "category_id": "44444444-4444-4444-8444-444444444444"},
        {"id": "77777777-7777-4777-8777-777777777777", "category_id": "55555555-5555-4555-8555-555555555555"},
    ]
    auth.client.table.side_effect = [category_query, existing_query, transaction_query]
    payload = TransactionImportInput.model_validate({
        "transactions": [
            {
                "transaction_type": "expense",
                "amount": "4500.00",
                "currency": "NGN",
                "description": "Uber ride",
                "transaction_date": "2026-09-01",
            },
            {
                "transaction_type": "expense",
                "amount": "2000.00",
                "currency": "NGN",
                "description": "Unmatched merchant",
                "transaction_date": "2026-09-02",
            },
        ],
    })

    result = import_transactions(payload, auth, "personal")

    upsert_rows = transaction_query.upsert.call_args.args[0]
    assert [row["category_id"] for row in upsert_rows] == [
        "44444444-4444-4444-8444-444444444444",
        "55555555-5555-4555-8555-555555555555",
    ]
    assert result["categorized"] == 2
    assert result["uncategorized"] == 0


def test_manual_category_update_changes_only_category() -> None:
    auth = make_auth()
    transaction = {"id": "55555555-5555-4555-8555-555555555555", "category_id": "44444444-4444-4444-8444-444444444444"}
    query = MagicMock()
    query.update.return_value.eq.return_value.execute.return_value.data = [transaction]
    auth.client.table.side_effect = None
    auth.client.table.return_value = query

    result = update_transaction_category(
        UUID(transaction["id"]),
        TransactionCategoryInput(category_id=UUID(transaction["category_id"])),
        auth,
    )

    auth.client.table.assert_called_once_with("transactions")
    query.update.assert_called_once_with({"category_id": transaction["category_id"]})
    assert result == transaction


def test_create_organization_uses_authenticated_database_function() -> None:
    auth = make_auth()
    organization = {
        "id": "22222222-2222-4222-8222-222222222222",
        "name": "Northstar Studio",
        "currency": "NGN",
        "created_by": auth.user_id,
    }
    auth.client.rpc.return_value.execute.return_value.data = [organization]

    result = create_organization(OrganizationInput(name="Northstar Studio"), auth)

    auth.client.rpc.assert_called_once_with(
        "create_organization",
        {
            "organization_name": "Northstar Studio",
            "organization_currency": "NGN",
        },
    )
    assert result == organization


def test_bootstrap_returns_null_profile_when_no_profile_row_exists() -> None:
    empty_response = SimpleNamespace(data=[])
    auth = make_auth({
        "profiles": None,
        "organization_members": empty_response,
        "categories": empty_response,
        "transactions": empty_response,
        "budgets": empty_response,
    })

    response = bootstrap(auth)

    assert response["profile"] is None
    assert response["default_workspace_id"] == "personal"


def test_support_access_reports_platform_admin_status() -> None:
    auth = make_auth({"platform_admins": SimpleNamespace(data={"user_id": "11111111-1111-4111-8111-111111111111"})})
    assert get_support_admin_access(auth) == {"is_support_admin": True}

    regular_user = make_auth()
    assert get_support_admin_access(regular_user) == {"is_support_admin": False}


def test_support_inbox_requires_platform_admin() -> None:
    app.dependency_overrides[get_authenticated_client] = lambda: make_auth()

    try:
        response = client.get("/api/support/admin/tickets")
    finally:
        app.dependency_overrides.pop(get_authenticated_client, None)

    assert response.status_code == 403
    assert response.json()["detail"] == "Support staff access is required"


def test_support_admin_can_list_inbox_tickets() -> None:
    ticket = {
        "id": "33333333-3333-4333-8333-333333333333",
        "requester_id": "11111111-1111-4111-8111-111111111111",
        "organization_id": None,
        "subject": "Cannot update my profile",
        "status": "open",
        "created_at": "2026-10-19T10:00:00Z",
    }
    auth = make_auth({
        "platform_admins": SimpleNamespace(data={"user_id": "11111111-1111-4111-8111-111111111111"}),
        "support_tickets": SimpleNamespace(data=[ticket]),
    })
    app.dependency_overrides[get_authenticated_client] = lambda: auth

    try:
        response = client.get("/api/support/admin/tickets")
    finally:
        app.dependency_overrides.pop(get_authenticated_client, None)

    assert response.status_code == 200
    assert response.json() == [ticket]


@pytest.mark.parametrize(
    ("authorize", "expected_detail"),
    [
        (lambda auth: require_platform_admin(auth), "Support staff access is required"),
        (
            lambda auth: require_workspace_admin(auth, UUID("22222222-2222-4222-8222-222222222222")),
            "Workspace admin access is required",
        ),
    ],
)
def test_missing_admin_membership_returns_forbidden(
    authorize: object,
    expected_detail: str,
) -> None:
    with pytest.raises(HTTPException) as error:
        authorize(make_auth())

    assert error.value.status_code == 403
    assert error.value.detail == expected_detail


def test_workspace_admin_check_returns_the_callers_role() -> None:
    auth = make_auth({
        "organization_members": SimpleNamespace(data={"role": "owner"}),
    })

    assert require_workspace_admin(auth, UUID("22222222-2222-4222-8222-222222222222")) == "owner"


def test_admin_cannot_invite_another_admin() -> None:
    auth = make_auth({
        "organization_members": SimpleNamespace(data={"role": "admin"}),
    })

    with pytest.raises(HTTPException) as error:
        invite_organization_member(
            UUID("22222222-2222-4222-8222-222222222222"),
            OrganizationMemberInviteInput(email="new-admin@example.com", role="admin"),
            auth,
        )

    assert error.value.status_code == 403
    assert error.value.detail == "Only the workspace owner can invite an admin."


def test_workspace_invite_uses_configured_auth_redirect(monkeypatch: pytest.MonkeyPatch) -> None:
    auth = make_auth({
        "organization_members": SimpleNamespace(data={"role": "owner"}),
    })
    invited_user = SimpleNamespace(id="44444444-4444-4444-8444-444444444444")
    service_client = MagicMock()
    service_client.auth.admin.invite_user_by_email.return_value.user = invited_user
    service_client.table.return_value.insert.return_value.execute.return_value.data = [
        {"created_at": "2026-10-20T10:00:00Z"},
    ]
    create_service_client = MagicMock(return_value=service_client)
    monkeypatch.setenv("SUPABASE_AUTH_REDIRECT_URL", "https://app.example.com")
    monkeypatch.setattr("backend.admin._service_client", create_service_client)

    result = invite_organization_member(
        UUID("22222222-2222-4222-8222-222222222222"),
        OrganizationMemberInviteInput(email="new-member@example.com", role="member"),
        auth,
    )

    service_client.auth.admin.invite_user_by_email.assert_called_once_with(
        "new-member@example.com",
        {"redirect_to": "https://app.example.com"},
    )
    assert result["invitation_sent"] is True


def test_workspace_owner_cannot_be_demoted_or_removed() -> None:
    auth = make_auth({
        "organization_members": SimpleNamespace(data={"role": "owner"}),
    })
    target_user_id = UUID("22222222-2222-4222-8222-222222222222")
    organization_id = UUID("33333333-3333-4333-8333-333333333333")

    with pytest.raises(HTTPException) as update_error:
        update_organization_member_role(
            target_user_id,
            organization_id,
            OrganizationMemberRoleInput(role="member"),
            auth,
        )
    with pytest.raises(HTTPException) as remove_error:
        remove_organization_member(target_user_id, organization_id, auth)

    assert update_error.value.status_code == 403
    assert update_error.value.detail == "The workspace owner role cannot be changed here."
    assert remove_error.value.status_code == 403
    assert remove_error.value.detail == "The workspace owner cannot be removed."


def test_updating_missing_support_ticket_returns_not_found() -> None:
    auth = make_auth()

    with pytest.raises(HTTPException) as error:
        update_ticket_status(
            UUID("33333333-3333-4333-8333-333333333333"),
            TicketStatusInput(status="resolved"),
            auth,
        )

    assert error.value.status_code == 404
    assert error.value.detail == "Support ticket not found"


def test_admin_dashboard_requires_authenticated_admin() -> None:
    response = client.get(
        "/api/admin/overview",
        params={"organization_id": "11111111-1111-4111-8111-111111111111"},
    )
    assert response.status_code == 401


def test_support_ticket_list_requires_authenticated_user() -> None:
    response = client.get("/api/support/tickets", params={"workspace_id": "personal"})
    assert response.status_code == 401
