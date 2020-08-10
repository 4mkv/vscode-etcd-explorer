#! /bin/bash

openssl genrsa -out ./server.key 2048
openssl req -new -key ./server.key -out ./server.csr -subj "/C=US/O=Test/OU=etcd/CN=192.168.86.163"

openssl x509 -req -in ./server.csr -CA ./ca.crt -CAkey ./ca.key -CAcreateserial \
-out ./server.crt -days 1825 -sha256 -extfile ./etcd-server.ext
