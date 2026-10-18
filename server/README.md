# Server setup

From the `server` directory, create and activate a virtual environment, then
install the project dependencies:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

The channel layer needs Redis on `127.0.0.1:6379` with no password (set
`REDIS_URL` to use another server). For example:

```powershell
docker run -d --name chaos-redis -p 6379:6379 redis
```

It also needs PostgreSQL. In debug mode the site connects to
`postgres://chaos:chaos@127.0.0.1:5432/chaos` (set `DATABASE_URL` to use
another server), which matches this container:

```powershell
docker run -d --name chaos-postgres -p 5432:5432 -e POSTGRES_USER=chaos -e POSTGRES_PASSWORD=chaos -e POSTGRES_DB=chaos -v chaos-postgres-data:/var/lib/postgresql postgres:18
```

To initialize the database and start the ASGI server:

```powershell
python manage.py migrate
python -m daphne -b 127.0.0.1 -p 8000 chaos_site.asgi:application
```

To run the tests (they need the PostgreSQL server, and create a temporary
database on it):

```powershell
python manage.py test game
```

## Running with Docker Compose

`compose.yaml` in the repository root runs the whole site: Daphne (this
directory's `Dockerfile`, with debug off), PostgreSQL and Redis. It only runs an
existing image, named by `CHAOS_IMAGE` (default `chaos-online:latest`), so it
works on a server without the source code. `compose.build.yaml` adds the build.
From the repository root:

```powershell
copy .env.example .env    # then set DJANGO_SECRET_KEY and POSTGRES_PASSWORD
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

On a server, copy `compose.yaml` and a `.env`, get the image there (for example
`docker save chaos-online:latest | ssh user@server docker load`, or push it to
a registry and set `CHAOS_IMAGE` to that name), then run `docker compose up -d`.

A one-off `migrate` container applies migrations before the site starts. The
site listens on `127.0.0.1:8000` by default (`CHAOS_BIND` and `CHAOS_PORT` in
`.env`). The database lives in the `postgres-data` volume. PostgreSQL and Redis
publish no ports, so they don't clash with the development containers above.
Behind an HTTPS reverse proxy, set `DJANGO_ALLOWED_HOSTS` and
`DJANGO_CSRF_TRUSTED_ORIGINS` to the public host name. The proxy must also
pass WebSocket upgrades through for `/ws/`.

### Hostinger VPS

`.github/workflows/deploy.yml` deploys every push to the `production` branch with Hostinger's
`deploy-on-vps` action. Hostinger's Docker Manager fetches the pushed commit and
runs `compose.hostinger.yaml`, which builds the image on the VPS and puts the
site behind the VPS's existing Traefik for HTTPS. Setup, once:

1. Point the domain's DNS A record at the VPS. The file expects Traefik's
   entrypoint `websecure` and certificate resolver `letsencrypt`, as in
   Hostinger's Traefik project (`docker inspect traefik-traefik-1` shows them).
   If they change, add `TRAEFIK_ENTRYPOINT` or `TRAEFIK_CERTRESOLVER` to the
   workflow's environment variables.
2. In hPanel, create an API key. The VM ID is the number in the VPS host name
   (`srv123456.hstgr.cloud` is `123456`).
3. If the repository is private, add the VPS's SSH key as a deploy key on
   GitHub (Settings > Deploy keys) so Docker Manager can fetch it.
4. In the GitHub repository, under Settings > Environments, create the
   environment `production` (the workflow's job uses it) and add the secrets `HOSTINGER_API_KEY`, `DJANGO_SECRET_KEY` and
   `POSTGRES_PASSWORD`, and the variables `HOSTINGER_VM_ID` and `DOMAIN` (the
   site's address, such as `www.example.com`). Optionally add `DOMAIN_ALIAS`,
   another host name that redirects to `DOMAIN` (such as `example.com`); its DNS
   record must point at the VPS too.
   Generate the key and password with
   `python -c "import secrets; print(secrets.token_urlsafe(50))"`: the action
   pastes the values into a shell command, so keep to letters, digits, `-`
   and `_`.
5. For the Django admin, add the secret `DJANGO_ADMIN_PATH`: a path that is
   hard to guess, such as `manage-` and some random letters (the same rule on
   characters applies). Without it the site has no admin. After the next
   deploy, create an account for it on the VPS:
   `docker compose -p chaos-online -f compose.hostinger.yaml exec web python manage.py createsuperuser`
   (or from the web container's terminal in Docker Manager:
   `python manage.py createsuperuser`). The admin is then at
   `https://<DOMAIN>/<DJANGO_ADMIN_PATH>/`.

### Admins

Users in the **Admins** group (Django admin > Users > the user > Groups), and
superusers, get an "All games" link: a list of every game, whoever played it,
where they can watch the replay of any finished game. They don't need staff
status or access to the Django admin.

The workflow passes when Hostinger accepts the deployment. Whether the build and
migrations then worked shows in hPanel's Docker Manager.

See [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for how the site works.
