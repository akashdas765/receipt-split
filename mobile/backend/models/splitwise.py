from pydantic import BaseModel


class CategoryPatch(BaseModel):
    categoryId: int


class ExpenseMember(BaseModel):
    id: int


class PostExpenseIn(BaseModel):
    description: str
    details: str | None = None
    groupId: int
    paidAmounts: dict[str, float] = {}
    personTotals: dict[str, float]
    members: list[ExpenseMember]
    expenseId: int | None = None
