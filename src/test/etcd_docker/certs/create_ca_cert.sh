#! /bin/bash

openssl genrsa -des3 -out $1ca.pass.key 2048
openssl rsa -in $1ca.pass.key -out $1ca.key
openssl req -x509 -new -nodes -key $1ca.key -sha256 -days 1825 -extensions v3_ca -out $1ca.pem -config ./openssl.cnf

## install cert-manager
# kubectl apply --validate=false -f https://github.com/jetstack/cert-manager/releases/download/v0.15.1/cert-manager.yaml