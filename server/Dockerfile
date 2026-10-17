ARG PYTHON_VERSION=3.10-slim

FROM python:${PYTHON_VERSION}

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN mkdir -p /code

WORKDIR /code

COPY requirements.txt /tmp/requirements.txt
RUN set -ex && \
    pip install --upgrade pip && \
    pip install -r /tmp/requirements.txt && \
    rm -rf /root/.cache/
COPY . /code

RUN python manage.py collectstatic --noinput

# Images run with debug off; DJANGO_SECRET_KEY must be passed at run time.
ENV DJANGO_DEBUG=0

EXPOSE 8000

# --proxy-headers: behind a reverse proxy, take the client address and scheme
# (https) from its X-Forwarded-* headers. --websocket_timeout -1: keep game
# connections open however long they last (Daphne closes them after a day
# by default).
CMD ["daphne","-b","0.0.0.0","-p","8000","--proxy-headers","--websocket_timeout","-1","chaos_site.asgi:application"]
