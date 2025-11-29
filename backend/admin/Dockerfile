FROM golang:alpine AS compiler

WORKDIR /usr/src/app

ENV CGO_ENABLED=0
ENV GOOS=linux

COPY go.mod .
COPY go.sum .
RUN go mod download

COPY . ./
ENV GOCACHE=/root/.cache/go-build
RUN --mount=type=cache,target="/root/.cache/go-build" \
    go build -o main_app main.go


FROM alpine

WORKDIR /usr/src/app
COPY --from=compiler /usr/src/app/main_app ./

EXPOSE 80
CMD [ "./main_app" ]