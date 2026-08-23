"""Direct port of mobile/src/utils/paymentDetector.js — same patterns, same
precedence (EXPENSE_OVERRIDES checked first in both isPaymentTransaction and
isCreditConfirmation). Keep the two files in sync; don't let this drift.
"""

import re

_PAYMENT_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"payment\s+thank\s+you",
        r"thank\s+you\s+payment",
        r"autopay",
        r"auto\s+pay",
        r"online\s+payment",
        r"mobile\s+payment",
        r"ach\s+payment",
        r"credit\s+card\s+pay",
        r"card\s+payment",
        r"e-payment",
        r"payment\s+to\s+.*\bcard\b",
        r"account\s+transfer",
        r"funds\s+transfer",
        r"bank\s+transfer",
        r"wire\s+transfer",
        r"transfer\s+to\b",
        r"transfer\s+from\b",
        r"internet\s+transfer",
        r"online\s+transfer",
        r"zelle\s+transfer",
        r"venmo\s+transfer",
        r"loan\s+payment",
        r"mortgage\s+payment",
        r"student\s+loan",
        r"auto\s+loan",
        r"^payment$",
        r"^transfer$",
        r"^deposit$",
        r"payoff",
        r"pay\s+off",
    ]
]

_EXPENSE_OVERRIDES = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"netflix", r"spotify", r"hulu", r"disney", r"amazon",
        r"apple", r"google", r"gym", r"insurance", r"rent",
        r"utility", r"electric", r"water", r"internet", r"phone",
    ]
]

_CREDIT_CONFIRMATION_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"payment\s+thank\s+you",
        r"thank\s+you\s+payment",
        r"autopay",
        r"auto\s+pay",
        r"online\s+payment",
        r"mobile\s+payment",
        r"ach\s+payment",
        r"credit\s+card\s+pay",
        r"card\s+payment",
        r"e-payment",
    ]
]

_INCOME_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"pyramid\s+consulti",
        r"payroll",
        r"direct\s+dep(osit)?",
        r"\bach\s+credit\b",
        r"\bsalary\b",
        r"\bwages\b",
        r"biweekly\s+pay",
        r"pay\s+period",
    ]
]


def is_payment_transaction(description: str = "") -> bool:
    desc = (description or "").strip()
    if any(r.search(desc) for r in _EXPENSE_OVERRIDES):
        return False
    return any(r.search(desc) for r in _PAYMENT_PATTERNS)


def is_credit_confirmation(description: str = "") -> bool:
    desc = (description or "").strip()
    if any(r.search(desc) for r in _EXPENSE_OVERRIDES):
        return False
    return any(r.search(desc) for r in _CREDIT_CONFIRMATION_PATTERNS)


def is_income_transaction(description: str = "") -> bool:
    desc = (description or "").strip()
    return any(r.search(desc) for r in _INCOME_PATTERNS)
