#! /bin/bash
cn=$1
openssl genrsa -out ./client-$1.key 2048
openssl req -new -key ./client-$1.key -out ./client-$1.csr -subj "/C=US/O=Test/OU=etcd/CN=$cn"

openssl x509 -req -in ./client-$1.csr -CA ./ca.crt -CAkey ./ca.key -CAcreateserial \
-out ./client-$1.crt -days 1825 -sha256 -extfile ./etcd-client.ext
