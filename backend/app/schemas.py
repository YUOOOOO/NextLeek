from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

UserRole = Literal["admin", "user"]


class LoginRequest(BaseModel):
    account: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=256)

    @model_validator(mode="before")
    @classmethod
    def accept_email_or_username(cls, data: object) -> object:
        if isinstance(data, dict) and not str(data.get("account") or "").strip():
            data = {
                **data,
                "account": data.get("email") or data.get("username") or "",
            }
        return data


class UserCreate(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=10, max_length=256)
    role: UserRole = "user"

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return value.strip().lower()


class UserUpdate(BaseModel):
    username: str | None = Field(
        default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$"
    )
    role: UserRole | None = None
    is_active: bool | None = None

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str | None) -> str | None:
        return value.strip().lower() if value is not None else None


class PasswordReset(BaseModel):
    password: str = Field(min_length=10, max_length=256)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=10, max_length=256)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    username: str
    role: UserRole
    is_active: bool
    created_at: datetime


class AiMessage(BaseModel):
    role: Literal["user", "bot"]
    text: str = Field(max_length=12000)
    formula: str | None = Field(default=None, max_length=4000)
    intent: Literal["strategy", "factor", "condition", "chat"] | None = None
    name: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=500)

class AiConversationWrite(BaseModel):
    messages: list[AiMessage] = Field(max_length=200)


class AiConversationRead(BaseModel):
    workspace: str
    messages: list[AiMessage]
    created_at: datetime
    updated_at: datetime


class AuthResponse(BaseModel):
    user: UserRead


class SetupStatus(BaseModel):
    configured: bool


class StrategyCondition(BaseModel):
    left: str = Field(min_length=1, max_length=64)
    op: str = Field(min_length=1, max_length=16)
    right: str | int | float = Field(...)
    leftDays: int = Field(default=0, ge=0, le=60)
    rightDays: int = Field(default=0, ge=0, le=60)


class StrategyBasicFilter(BaseModel):
    price_min: float | None = 3
    price_max: float | None = 300
    market_cap_min: float | None = 10e8
    amount_min: float | None = 0.2e8
    exclude_st: bool = True
    boards: list[str] = Field(
        default_factory=lambda: ["沪主板", "深主板", "创业板", "科创板", "北交所"]
    )


class StrategyChildRef(BaseModel):
    strategy_id: str = Field(min_length=1, max_length=36)
    weight: float = Field(default=1, ge=0)


class StrategyChildRead(BaseModel):
    strategy_id: str
    name: str = ""
    weight: float = 1


class StrategyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    description: str = Field(default="", max_length=500)
    kind: Literal["formula", "conditions", "composite"] = "conditions"
    formula: str = Field(default="", max_length=4000)
    conditions: list[StrategyCondition] = Field(default_factory=list, max_length=8)
    children: list[StrategyChildRef] = Field(default_factory=list, max_length=8)
    merge_mode: Literal["union", "intersect"] = "union"
    min_confirm: int = Field(default=1, ge=1, le=8)
    basic_filter: StrategyBasicFilter = Field(default_factory=StrategyBasicFilter)
    order_by: str = Field(default="change_pct", max_length=64)
    descending: bool = True
    limit: int = Field(default=100, ge=1, le=500)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("策略名称不能为空")
        return name

    @field_validator("description")
    @classmethod
    def strip_description(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def require_body(self) -> StrategyCreate:
        if self.kind == "composite":
            if len(self.children) < 2:
                raise ValueError("叠加至少选择 2 个策略")
        elif self.kind == "formula":
            if not self.formula.strip():
                raise ValueError("请填写策略公式")
        elif len(self.conditions) < 1:
            raise ValueError("至少一条条件")
        return self


class StrategyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    description: str | None = Field(default=None, max_length=500)
    kind: Literal["formula", "conditions", "composite"] | None = None
    formula: str | None = Field(default=None, max_length=4000)
    conditions: list[StrategyCondition] | None = Field(default=None, max_length=8)
    children: list[StrategyChildRef] | None = Field(default=None, max_length=8)
    merge_mode: Literal["union", "intersect"] | None = None
    min_confirm: int | None = Field(default=None, ge=1, le=8)
    basic_filter: StrategyBasicFilter | None = None
    order_by: str | None = Field(default=None, max_length=64)
    descending: bool | None = None
    limit: int | None = Field(default=None, ge=1, le=500)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        name = value.strip()
        if not name:
            raise ValueError("策略名称不能为空")
        return name

    @field_validator("description")
    @classmethod
    def strip_description(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None


class StrategyRead(BaseModel):
    id: str
    name: str
    description: str
    status: Literal["draft", "published"]
    kind: Literal["formula", "conditions", "composite"] = "conditions"
    formula: str = ""
    conditions: list[StrategyCondition]
    children: list[StrategyChildRead] = []
    merge_mode: Literal["union", "intersect"] = "union"
    min_confirm: int = 1
    basic_filter: StrategyBasicFilter
    order_by: str
    descending: bool
    limit: int
    owner_id: str
    owner_username: str
    subscriber_count: int
    subscribed: bool
    is_owner: bool
    monitoring: bool = False
    version: int = 0
    has_unpublished_changes: bool = False
    update_available: bool = False
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None

    @field_validator("kind", mode="before")
    @classmethod
    def coerce_kind(cls, value: object) -> str:
        if value in {"formula", "conditions", "composite"}:
            return str(value)
        return "formula"


class StrategyCatalog(BaseModel):
    mine: list[StrategyRead]
    subscribed: list[StrategyRead]
    market: list[StrategyRead]


class StrategyRunResult(BaseModel):
    as_of: str | None
    strategy_id: str
    rows: list[dict]
    total: int
    elapsed_ms: float
    warnings: list[str] = []


class FactorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    code: str | None = Field(default=None, max_length=40)
    description: str = Field(default="", max_length=500)
    formula: str = Field(min_length=1, max_length=2000)
    direction: Literal["high", "low", "none"] = "none"


    @field_validator("code", mode="before")
    @classmethod
    def empty_code(cls, value: str | None) -> str | None:
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        return value
    @field_validator("name", "code", "description", "formula")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        if not text:
            raise ValueError("不能为空")
        return text


class FactorUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    description: str | None = Field(default=None, max_length=500)
    formula: str | None = Field(default=None, min_length=1, max_length=2000)
    direction: Literal["high", "low", "none"] | None = None

    @field_validator("name", "description", "formula")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        if not text:
            raise ValueError("不能为空")
        return text


class FactorRead(BaseModel):
    id: str
    code: str
    name: str
    description: str
    formula: str
    direction: Literal["high", "low", "none"] = "none"
    status: Literal["draft", "published"]
    owner_id: str
    owner_username: str
    subscriber_count: int
    subscribed: bool
    is_owner: bool
    version: int = 0
    warmup_bars: int = 1
    has_unpublished_changes: bool = False
    update_available: bool = False
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None


class FactorCatalog(BaseModel):
    mine: list[FactorRead]
    subscribed: list[FactorRead]
    market: list[FactorRead]


class FactorCompileIn(BaseModel):
    formula: str = Field(min_length=1, max_length=2000)


class FactorGenerateIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=500)


class FactorResearchIn(BaseModel):
    days: int = Field(default=240, ge=20, le=1500)
    horizon: int = Field(default=1, ge=1, le=20)
    start: date | None = None
    end: date | None = None


class StrategyGenerateIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=500)


class StrategyCompileIn(BaseModel):
    formula: str = Field(min_length=1, max_length=4000)


class StrategyResearchIn(BaseModel):
    days: int = Field(default=240, ge=20, le=1500)
    horizon: int = Field(default=1, ge=1, le=60)
    start: date | None = None
    end: date | None = None
    initial_capital: float = Field(default=1_000_000, gt=0, le=1e10)
    commission_pct: float = Field(default=0.0002, ge=0, le=0.05)
    stamp_tax_pct: float = Field(default=0.001, ge=0, le=0.05)
    slippage_bps: float = Field(default=5, ge=0, le=1000)
    max_positions: int = Field(default=10, ge=1, le=200)
    max_exposure_pct: float = Field(default=1.0, gt=0, le=1)
    holding_days: int | None = Field(default=None, ge=1, le=60)
    entry_fill: Literal["close_t", "open_t+1"] = "open_t+1"
    exit_fill: Literal["close_t", "open_t+1"] = "open_t+1"


class FormulaPreview(BaseModel):
    ok: bool
    formula: str
    warmup_bars: int = 1
    dependencies: list[str] = []
    errors: list[dict] = []
