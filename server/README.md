# Server setup

From the `server` directory, create and activate a virtual environment, then
install the project dependencies:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

To initialize the database and start the ASGI server:

```powershell
python manage.py migrate
python -m daphne -b 127.0.0.1 -p 8000 chaos_site.asgi:application
```
