FROM golang:1.25-bookworm AS compiler

WORKDIR /usr/src/app

RUN apt-get update && apt-get install -y --no-install-recommends librdkit-dev libboost-dev && rm -rf /var/lib/apt/lists/*

ENV CGO_ENABLED=1
ENV GOOS=linux

COPY go.mod .
COPY go.sum .
RUN go mod download

COPY . ./
ENV GOCACHE=/root/.cache/go-build
RUN --mount=type=cache,target="/root/.cache/go-build" \
    go build -tags rdkit -o main_app main.go


FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl poppler-utils librdkit1 && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY --from=compiler /usr/src/app/main_app ./
RUN mkdir ./docs
COPY --from=compiler /usr/src/app/docs/swagger.json ./docs/swagger.json

EXPOSE 80
CMD [ "./main_app" ]
