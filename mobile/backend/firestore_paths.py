"""users/{uid}/... collection-reference helpers — the Python equivalent of
db.js's receiptsCol()/transactionsCol()/etc., one place so every router
builds the exact same paths the JS client used (zero data migration).
"""


def _user(db, uid):
    return db.collection("users").document(uid)


def receipts_col(db, uid):
    return _user(db, uid).collection("receipts")


def transactions_col(db, uid):
    return _user(db, uid).collection("transactions")


def plaid_connections_col(db, uid):
    return _user(db, uid).collection("plaidConnections")


def source_meta_col(db, uid):
    return _user(db, uid).collection("sourceMeta")


def manual_accounts_col(db, uid):
    return _user(db, uid).collection("manualAccounts")


def net_worth_snapshots_col(db, uid):
    return _user(db, uid).collection("netWorthSnapshots")


def notifications_col(db, uid):
    return _user(db, uid).collection("notifications")


def user_doc(db, uid):
    return _user(db, uid)
