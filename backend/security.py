from __future__ import annotations

import os
from typing import Annotated
from uuid import UUID

from dotenv import load_dotenv
from fastapi import Depends, Header, HTTPException, status
from supabase import Client, create_client

load_dotenv()


class AuthenticatedClient:
    def __init__(self, client: Client, user_id: str, email: str, user_metadata: dict) -> None:
        self.client = client
        self.user_id = user_id
        self.email = email
        self.user_metadata = user_metadata


def get_authenticated_client(authorization: Annotated[str | None, Header()] = None) -> AuthenticatedClient:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="A Supabase access token is required")

    token = authorization.split(" ", maxsplit=1)[1].strip()
    supabase_url = os.getenv("SUPABASE_URL")
    anon_key = os.getenv("SUPABASE_ANON_KEY")
    if not supabase_url or not anon_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Supabase is not configured")

    client = create_client(
        supabase_url,
        anon_key,
    )
    try:
        user_result = client.auth.get_user(token)
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="The access token is invalid or expired") from error
    if not user_result.user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="The access token is invalid or expired")
    client.postgrest.auth(token)
    return AuthenticatedClient(
        client,
        str(user_result.user.id),
        user_result.user.email or "",
        user_result.user.user_metadata or {},
    )


Auth = Annotated[AuthenticatedClient, Depends(get_authenticated_client)]


def require_workspace_admin(auth: AuthenticatedClient, organization_id: UUID) -> str:
    membership_result = (
        auth.client.table("organization_members")
        .select("role")
        .eq("organization_id", str(organization_id))
        .eq("user_id", auth.user_id)
        .maybe_single()
        .execute()
    )
    membership = membership_result.data if membership_result is not None else None
    if not membership or membership.get("role") not in ("owner", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Workspace admin access is required")
    return membership["role"]


def require_platform_admin(auth: AuthenticatedClient) -> None:
    result_response = (
        auth.client.table("platform_admins")
        .select("user_id")
        .eq("user_id", auth.user_id)
        .maybe_single()
        .execute()
    )
    result = result_response.data if result_response is not None else None
    if not result:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Support staff access is required")