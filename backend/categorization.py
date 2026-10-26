from __future__ import annotations

import re


_INCOME_DESCRIPTION = re.compile(
    r"\b(?:salary|wages?|freelance|refund|cashback|transfer\s+from|transfer\s+in|credit received|deposit|interest earned|dividend)\b",
    re.IGNORECASE,
)

_RULES: tuple[tuple[re.Pattern[str], tuple[str, ...], str], ...] = (
    (re.compile(r"\b(?:salary|wages?|payroll|staff pay)\b", re.IGNORECASE), ("Salary", "Payroll", "Revenue", "Client Revenue"), "income"),
    (re.compile(r"\b(?:freelance|client payment|invoice paid|sales revenue|dividend|interest earned|refund|cashback|reversal|credit received|transfer in|deposit)\b", re.IGNORECASE), ("Freelance", "Revenue", "Client Revenue", "Other income"), "income"),
    (re.compile(r"\b(?:uber|bolt|indrive|yango|taxi|cab fare|ride[- ]hailing|bus fare|train fare|transport|fuel|petrol|gas station|parking|toll)\b", re.IGNORECASE), ("Transportation", "Transport", "Travel", "Operations"), "expense"),
    (re.compile(r"\b(?:shoprite|spar|supermarket|grocery|groceries|market|foodstuff)\b", re.IGNORECASE), ("Groceries", "Meals & groceries", "Food & Dining"), "expense"),
    (re.compile(r"\b(?:restaurant|cafe|coffee|bakery|food|meal|lunch|dinner|breakfast|chicken republic|kfc|domino'?s|pizza|mcdonald)\b", re.IGNORECASE), ("Food & Dining", "Meals & groceries", "Groceries"), "expense"),
    (re.compile(r"\b(?:rent|landlord|mortgage|housing|house lease)\b", re.IGNORECASE), ("Housing", "Operations"), "expense"),
    (re.compile(r"\b(?:electricity|power bill|phcn|aedc|ekedc|ibedc|water bill|utility|utilities|internet|broadband|wifi|airtel|mtn|glo|9mobile|airtime|data bundle|dstv|gotv|startimes)\b", re.IGNORECASE), ("Utilities", "Bills", "Operations"), "expense"),
    (re.compile(r"\b(?:netflix|spotify|youtube premium|showmax|prime video|subscription|apple music)\b", re.IGNORECASE), ("Subscriptions", "Entertainment", "Software"), "expense"),
    (re.compile(r"\b(?:software|saas|hosting|domain renewal|cloud service|adobe|microsoft 365|google workspace)\b", re.IGNORECASE), ("Software", "Subscriptions", "Operations"), "expense"),
    (re.compile(r"\b(?:hospital|clinic|pharmacy|chemist|medical|doctor|health|laboratory|dental|medicine|prescription)\b", re.IGNORECASE), ("Health & wellness", "Operations"), "expense"),
    (re.compile(r"\b(?:clothing|apparel|fashion|shoes|tailor|garment)\b", re.IGNORECASE), ("Clothing", "Personal care", "Operations"), "expense"),
    (re.compile(r"\b(?:school|tuition|university|education|course fee|textbook|training)\b", re.IGNORECASE), ("Education", "Operations"), "expense"),
    (re.compile(r"\b(?:cinema|movie|concert|entertainment|game|event ticket)\b", re.IGNORECASE), ("Entertainment", "Operations"), "expense"),
    (re.compile(r"\b(?:office supplies|stationery|contractor|marketing|advertising|tax|payroll|business expense)\b", re.IGNORECASE), ("Office supplies", "Contractors", "Marketing", "Taxes & fees", "Payroll", "Operations"), "expense"),
)


def infer_transaction_type(description: str, current_type: str) -> str:
    if _INCOME_DESCRIPTION.search(description):
        return "income"
    return current_type


def suggest_category_id(description: str, transaction_type: str, categories: list[dict]) -> str | None:
    def match_category(names: tuple[str, ...]) -> str | None:
        for name in names:
            category = next(
                (
                    item for item in categories
                    if item.get("name", "").casefold() == name.casefold()
                    and item.get("category_type") in (transaction_type, "both")
                ),
                None,
            )
            if category:
                return str(category["id"])
        return None

    for pattern, category_names, rule_type in _RULES:
        if transaction_type != rule_type or not pattern.search(description):
            continue
        category_id = match_category(category_names)
        if category_id:
            return category_id
    fallback_categories = ("Other income", "Revenue", "Client Revenue") if transaction_type == "income" else ("Other expenses", "Operations")
    return match_category(fallback_categories)
