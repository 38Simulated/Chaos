from django.contrib.staticfiles.storage import ManifestStaticFilesStorage


class HashedStaticFilesStorage(ManifestStaticFilesStorage):
    """collectstatic writes a copy of each file with a content hash in its name.

    The client's ES modules import each other by relative path, so the
    import lines are rewritten to the hashed names too. Otherwise a changed
    module would keep its old name and browsers could run a stale copy.
    """
    support_js_module_import_aggregation = True
