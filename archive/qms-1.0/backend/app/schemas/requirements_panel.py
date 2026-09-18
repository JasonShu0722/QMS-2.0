"""
Schemas for the online requirements panel.
"""
from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class RequirementPanelStatusValue(str, Enum):
    TODO = "todo"
    DOING = "doing"
    DEV_DONE = "dev-done"
    VERIFIED = "verified"
    RESERVED = "reserved"


class RequirementPanelUserRole(str, Enum):
    ADMIN = "admin"
    VIEWER = "viewer"


class RequirementPanelLoginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=128)


class RequirementPanelUserResponse(BaseModel):
    id: int
    username: str
    full_name: str
    role: RequirementPanelUserRole
    is_active: bool
    last_login_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class RequirementPanelLoginResponse(BaseModel):
    access_token: str
    token_type: str
    user: RequirementPanelUserResponse


class RequirementPanelStatusUpdateRequest(BaseModel):
    status: RequirementPanelStatusValue = Field(..., description="New requirement status")


class RequirementPanelStatusItemResponse(BaseModel):
    item_id: str
    status: RequirementPanelStatusValue
    updated_at: datetime
    updated_by: Optional[int] = None
    updated_by_name: Optional[str] = None

    class Config:
        from_attributes = True


class RequirementPanelStatusListResponse(BaseModel):
    can_update: bool
    items: List[RequirementPanelStatusItemResponse]
