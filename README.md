# Etcd Manager
Visual Studio Code Extension for Managing Etcd
- Explore etcd v2 and etcd v3 in explorer tree
- view values for keys in editor
- export keys as JSON
- import JSON
- delete keys 

# TLS And Authentication
- No Auth
- Basic Auth 
  - Enable/Disable
  - Login/Logout
  - Add/Remove User/Role
    If logged in with basic auth Add user/Remove user
- TLS for Authentication (Server setup out of scope)
  - accept client-crt and client-key
- TLS for transport (Server setup out of scope)
  - accept ca-cert.
    if Protocol is https- ask for ca-cert used to sign server certificates
  - works with No Auth/Basic Auth/TLS Auth 
    Default is NO Auth
    Enable/Disable Basic Auth
    Login/Logout -> Basic Auth/TLS Auth
