FROM golang:alpine AS compiler

WORKDIR /usr/src/app
COPY . ./

ENV CGO_ENABLED 0
ENV GOOS linux

RUN go build -o main_app main.go


FROM alpine

WORKDIR /usr/src/app
COPY --from=compiler /usr/src/app/main_app ./

EXPOSE 80
CMD [ "./main_app" ]