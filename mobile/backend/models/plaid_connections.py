from pydantic import BaseModel


class PlaidAccount(BaseModel):
    id: str
    name: str | None = None
    mask: str | None = None
    nickname: str | None = None
    accountType: str | None = None  # 'bank' | 'credit'


# itemId required, everything else optional/partial (matches
# savePlaidConnection's JS signature exactly — {itemId, accessToken,
# cursor, institutionName, accounts}, only pass what changed; whatever's
# omitted stays untouched via exclude_unset in the router, not overwritten).
class PlaidConnectionIn(BaseModel):
    itemId: str
    accessToken: str | None = None
    cursor: str | None = None
    institutionName: str | None = None
    accounts: list[PlaidAccount] | None = None
