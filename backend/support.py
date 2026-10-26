from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from backend.security import Auth, AuthenticatedClient, require_platform_admin, require_workspace_admin

router = APIRouter(prefix="/api/support", tags=["support"])


@router.get("/admin/access")
def get_support_admin_access(auth: Auth) -> dict[str, bool]:
    result = (
        auth.client.table("platform_admins")
        .select("user_id")
        .eq("user_id", auth.user_id)
        .maybe_single()
        .execute()
    )
    return {"is_support_admin": bool(result and result.data)}


@router.get("/admin/tickets")
def list_support_inbox_tickets(auth: Auth) -> list[dict]:
    require_platform_admin(auth)
    return (
        auth.client.table("support_tickets")
        .select("id,requester_id,organization_id,subject,status,created_at")
        .order("updated_at", desc=True)
        .limit(100)
        .execute()
        .data
    )


class TicketInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject: str = Field(min_length=4, max_length=140)
    message: str = Field(min_length=1, max_length=3000)


class MessageInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=3000)


class TicketStatusInput(BaseModel):
    status: Literal["open", "in_progress", "resolved"]


def authorize_ticket_admin(auth: AuthenticatedClient, ticket: dict) -> None:
    organization_id = ticket.get("organization_id")
    if organization_id:
        require_workspace_admin(auth, UUID(organization_id))
    else:
        require_platform_admin(auth)


@router.get("/tickets")
def list_tickets(auth: Auth, workspace_id: str = Query(min_length=1)) -> list[dict]:
    query = auth.client.table("support_tickets").select("*")
    if workspace_id == "personal":
        query = query.is_("organization_id", "null")
    else:
        try:
            workspace_id = str(UUID(workspace_id))
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Workspace ID is invalid") from error
        query = query.eq("organization_id", workspace_id)
    return query.order("updated_at", desc=True).limit(100).execute().data


@router.post("/tickets", status_code=status.HTTP_201_CREATED)
def create_ticket(
    payload: TicketInput,
    auth: Auth,
    workspace_id: str = Query(min_length=1),
) -> dict:
    organization_id = None
    if workspace_id != "personal":
        try:
            organization_id = str(UUID(workspace_id))
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Workspace ID is invalid") from error
    ticket = auth.client.table("support_tickets").insert({
        "requester_id": auth.user_id,
        "organization_id": organization_id,
        "subject": payload.subject,
    }).execute().data[0]
    auth.client.table("support_messages").insert({
        "ticket_id": ticket["id"],
        "sender_id": auth.user_id,
        "body": payload.message,
    }).execute()
    return ticket


@router.get("/tickets/{ticket_id}/messages")
def list_messages(ticket_id: UUID, auth: Auth) -> list[dict]:
    return (
        auth.client.table("support_messages")
        .select("*")
        .eq("ticket_id", str(ticket_id))
        .order("created_at")
        .execute()
        .data
    )


@router.post("/tickets/{ticket_id}/messages", status_code=status.HTTP_201_CREATED)
def add_message(ticket_id: UUID, payload: MessageInput, auth: Auth) -> dict:
    result = (
        auth.client.table("support_messages")
        .insert({"ticket_id": str(ticket_id), "sender_id": auth.user_id, "body": payload.message})
        .execute()
        .data
    )
    return result[0]


@router.patch("/tickets/{ticket_id}")
def update_ticket_status(ticket_id: UUID, payload: TicketStatusInput, auth: Auth) -> dict:
    ticket_result = (
        auth.client.table("support_tickets")
        .select("id,organization_id")
        .eq("id", str(ticket_id))
        .maybe_single()
        .execute()
    )
    ticket = ticket_result.data if ticket_result is not None else None
    if not ticket:
        raise HTTPException(status_code=404, detail="Support ticket not found")
    authorize_ticket_admin(auth, ticket)
    result = (
        auth.client.table("support_tickets")
        .update({"status": payload.status})
        .eq("id", str(ticket_id))
        .execute()
        .data
    )
    return result[0]