FROM python:3.12-alpine
WORKDIR /app
COPY cfg.py graph.py store.py meta_translate.py views.py server.py /app/
COPY static /app/static
ENV STATIC_DIR=/app/static
EXPOSE 8788
CMD ["python3", "server.py"]
