import uvicorn

from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from fastapi import FastAPI


middleware = [
    Middleware(
        CORSMiddleware,
        allow_origins=['*'],
        allow_credentials=True,
        allow_methods=['*'],
        allow_headers=['*']
    )
]


app = FastAPI(middleware=middleware)


@app.get("/")
def index() -> dict[str, str]:
    return {"Hello": "World!"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=80)
