import * as vscode from 'vscode';
import { EtcdExplorerBase, EtcdNode } from "./etcdExplorer"
const Etcd2 = require('node-etcd');
var fs = require('fs');

var separator = "/";
var schema = "etcd2_value_text_schema"

export class Etcd2Explorer extends EtcdExplorerBase implements vscode.TreeDataProvider<EtcdNode> {
  constructor(_context: vscode.ExtensionContext) {
    super(schema, _context);
    this.initClient();
  }

  initClient() {
    super.initClient();
    if (!this.etcd_host) {
      return;
    }
    if ((this.etcd_host.toLowerCase().startsWith("https:")) && !this.host_options.ca) {
      var conf = vscode.workspace.getConfiguration('etcd-explorer');
      if (conf.root_ca_path) {
        this.host_options.ca = fs.readFileSync(conf.root_ca_path);
      }
    }
    if (this.authentication) {
      this.host_options.auth = {
        user: this.authentication.username,
        pass: this.authentication.password
      }
    }
    this.client = new Etcd2([this.etcd_host], this.host_options);
    this.isAuthEnabled();
    this.initAllData(this.RootNode(), this.jsonToLevelNodeList, true, true);
    console.log("Done .. nodes");
  }

  async isAuthEnabled() {
    if (this.client === undefined) return;
    var options = (this.host_options) ? this.host_options : {};
    this.client.raw("GET", "v2/auth/enable", null, options, (err: any, val: any) => {
      if (val === undefined) {
        console.log(require('util').inspect(err, true, 10));
        vscode.window.showErrorMessage(err.toString());
        return;
      }
      if (val.enabled) {
        console.log("Auth is enabled");
        vscode.commands.executeCommand('setContext', 'etcdcluster.tlsauth', false);
        vscode.commands.executeCommand('setContext', 'etcd2.basicauth_enabled', true);
        this.authEnabled = true;
        if (this.authentication) {
          this.setTreeViewTitleUser(this.authentication.username, this.authentication.roles);
        }
        else {
          this.setTreeViewTitleUser();
        }
      }
      else {
        if (this.host_options && (this.host_options.cert.length > 0)) {
          console.log("tls Auth is enabled");
          let tls = require('tls');
          let net = require('net');

          let secureContext = tls.createSecureContext({
            cert: this.host_options.cert
          });

          let secureSocket = new tls.TLSSocket(new net.Socket(), { secureContext });

          let cert = secureSocket.getCertificate();
          vscode.commands.executeCommand('setContext', 'etcdcluster.tlsauth', true);
          vscode.commands.executeCommand('setContext', 'etcd2.basicauth_enabled', false);
          this.authEnabled = true;
          this.setTreeViewTitleUser(undefined, undefined, cert.subject.CN);
        }
        else {
          console.log("Auth is disabled");
          vscode.commands.executeCommand('setContext', 'etcdcluster.tlsauth', false);
          vscode.commands.executeCommand('setContext', 'etcd2.basicauth_enabled', false);
          this.authEnabled = false;
          this.setTreeViewTitleUser();
        }
      }
    })
  }

  async enableAuth() {
    if (this.client === undefined) return;
    var self = this;
    var options = (this.host_options) ? this.host_options : {};
    await this.client.raw("PUT", "v2/auth/enable", null, options, (err: any, val: any) => {
      if (err != undefined) {
        console.log(require('util').inspect(err, true, 10));
        vscode.window.showErrorMessage(err.toString());
        return;
      }
      var no_root = "auth: No root user available, please create one";
      if (val && (val.message) && (no_root.indexOf(val.message) >= 0)) {
        var pwdBox = vscode.window.createInputBox();
        pwdBox.title = "Creating root user, please provide password for root user";
        pwdBox.password = true;
        pwdBox.onDidAccept(async () => {
          //pwdBox.hide();
          var pwd = pwdBox.value;
          var root = {
            user: "root",
            password: pwd
          }
          var dataString = JSON.stringify(root);
          /*          var options = (this.host_options) ? this.host_options : {};
                    this.client.raw("PUT", "/v2/auth/users/root", dataString, options, (err: any, val: any, headers: any) => {
                      console.log(val);
          
                    });
          */
          var headers = {
            'Content-Type': 'application/json',
            'Content-Length': dataString.length
          };

          var http = require('http');
          var https = require('https');
          var agent = (this.protocol == "https:") ? https : http;
          const { URL } = require('url');

          var url = new URL("/v2/auth/users/root", `${this.etcd_host}`);

          var hoptions = {
            method: "PUT",
            headers: headers
          };

          var req = agent.request(url, hoptions, function (res: any) {
            res.setEncoding('utf-8');

            var responseString = '';
            res.on('error', function (err: any) {
              console.log(err);
            });
            res.on('data', function (data: any) {
              responseString += data;
            });

            res.on('end', function () {
              console.log(responseString);
              var responseObject = JSON.parse(responseString);
              if (responseObject.user == "root") {
                self.enableAuth();
                pwdBox.dispose();
              }
            });
          });
          req.write(dataString);
          req.end();
        });
        pwdBox.show();
      }
      else {
        this.isAuthEnabled();
      }
    });
  }

  async disableAuth() {
    if (this.client === undefined) return;
    var options = (this.host_options) ? this.host_options : {};
    this.client.raw("DELETE", "v2/auth/enable", null, options, (err: any, val: any) => {
      if (!err) {
        console.log("Auth is disabled");
        this.authEnabled = false;
        this.logout();
      }
    });
  }

  async loginas(user: string, pwd: string) {
    if (!this.etcd_host) return;
    var options = this.host_options;
    options.auth = {
      user: user,
      pass: pwd
    }
    this.client = new Etcd2([this.etcd_host], options);
    if (!this.client) return;

    var roles: string[] = [];
    var options = (this.host_options) ? this.host_options : {};
    this.client.raw("GET", "/v2/auth/users/" + user, null, options, async (err: any, resp: any) => {
      if (err != undefined) {
        console.log(require('util').inspect(err, true, 10));
        vscode.window.showErrorMessage(err.toString());
        return;
      }
      vscode.commands.executeCommand('setContext', 'etcd2.basicauth', true);
      if (resp && resp.roles) {
        for (var element of resp.roles) {
          roles.push(element.role);
          if (element.role == "root") {
            vscode.commands.executeCommand('setContext', 'etcd2.basicauthroot', true);
          }
        }
        this.setTreeViewTitleUser(user, roles);
        this.authentication = {};
        this.authentication.username = user;
        this.authentication.password = pwd;
        this.authentication.roles = roles;
        if (this.etcd_host) {
          this.refreshView(this.etcd_host);
        }
      }
    });
  }

  getTreeItem(element: EtcdNode): vscode.TreeItem {
    if (element.isLeafNode()) {
      element.command = { command: 'etcd-explorer.etcd2view.showvalue', title: "Show Value", arguments: [element], };
    }
    return element;
  }

  async deleteKeys(prefix: string) {
    return new Promise((resolve, reject) => {
      try {
        if (this.client != undefined) {
          this.client.del(prefix, { recursive: true }, (err: any, val: any) => {
            if (err) {
              console.log("Error: deleting " + prefix + " " + err.message + " [" + this.schema() + "]");
              if (prefix.endsWith(separator)) {
                this.client.del(prefix, { recursive: true }, (err2: any, val: any) => {
                  if (err2) {
                    console.log("Error: deleting " + prefix + " " + err.message + " [" + this.schema() + "]");
                    reject(err2.message);
                  }
                  else {
                    console.log(prefix + " deleted" + " [" + this.schema() + "]");
                    resolve();
                  }
                });
              }
              else {
                reject(err.message);
              }
            }
            else {
              console.log(prefix + " deleted" + " [" + this.schema() + "]");
              resolve();
            }
          });
        }
        else {
          reject("etcd client is not ready.");
        }
      }
      catch (err) {
        reject(err.message);
      }
    });
  }

  async initAllData(node: EtcdNode, callback: Function, ignoreParentKeys?: boolean, recursive?: boolean) {
    if (!this.isVisible) return;
    if (this.client === undefined) return;
    if (node.isLeafNode()) return;
    var prefix = node.prefix;
    var removePrefixFromKeys = (ignoreParentKeys != undefined) ? ignoreParentKeys : true;
    var recursion = (recursive != undefined) ? recursive : false;
    var nodeList = node.getChildren();

    if (!nodeList.canUpdate())
      return;
    nodeList.updating();

    var self = this;
    this.client.get(prefix, { recursive: recursion },
      (err: any, val: any) => {
        try {
          if (val === undefined) {
            console.log(require('util').inspect(err, true, 10));
            vscode.window.showErrorMessage(err.toString());
            throw err.toString();
          }
          // node must be there
          if (val.node === undefined) {
            throw "node is undefined";
          }
          var jsonObj = Object.create({});
          var obj = jsonObj;
          // node must be either dir or leaf
          if ((val.node.dir && val.node.nodes != undefined && val.node.nodes.length > 0) ||
            (val.node.value != undefined)) {
            if (removePrefixFromKeys == false) {
              var parentKeys = prefix.split(separator);
              if (parentKeys.length > 0) {
                for (var pk of parentKeys) {
                  if (pk != undefined && pk.length > 0) {
                    obj[pk] = Object.create({});
                    obj = obj[pk];
                  }
                }
              }
            }
            var keyObjs = [{ key: val.node, obj: obj, prefix: prefix }];
            while (keyObjs.length > 0) {
              var keyObj = keyObjs.pop()
              var currentKey = keyObj?.key;
              var currentObj = keyObj?.obj;
              var currentPrefix = keyObj?.prefix
              if (!currentKey.dir) {
                var keyw = currentKey.key.split(separator).pop();
                currentObj[keyw] = currentKey.value;
              }
              else {
                for (var childKey of currentKey.nodes) {
                  var keyw = childKey.key.replace(currentPrefix, "");
                  if (childKey.dir) {
                    currentObj[keyw] = Object.create({});
                    if (recursion == true) {
                      keyObjs.push({ key: childKey, obj: currentObj[keyw], prefix: childKey.key + separator });
                    }
                  }
                  else {
                    currentObj[keyw] = childKey.value;
                  }
                }
              }
            }
            callback(jsonObj, node, self);
          }
        }
        catch (e) {
          console.log(e);
        }
        finally {
          nodeList.updated();
          self.refresh();
        }
      }
    );
  }

  async getValue(key: string): Promise<any> {
    var value: any;
    var error: string;
    await this.client.get(key, (err: any, val: any) => {
      if (err) {
        console.log("Error: getting key (" + key + ") " + err.message + " [" + this.schema() + "]");
      }
      else {
        // node must be there
        if (val.node === undefined) {
          error = "Error: node is undefined for key " + key;
        }
        value = val.node.value;
      }
    });
    return new Promise((resolve, reject) => {
      var timer = setInterval(() => {
        if (value != undefined || error != undefined) {
          clearInterval(timer);
          if (!value && error)
            reject(error);
          else
            resolve(value);
        }
      }, 100);
    });
  }

  protected async write(key: string, value: any) {
    var self = this;
    return new Promise((resolve, reject) => {
      this.client.set(key, value, (err: any, val: any) => {
        if (err) {
          console.log("Error: writing key (" + key + ") " + err.message + " [" + this.schema() + "]");
          reject(err.message);
        }
        else {
          console.log("Written key " + key + " [" + this.schema() + "]");
          resolve();
        }
      });
    });
  }

  resetContextValues() {
    vscode.commands.executeCommand('setContext', 'etcd2.basicauth_enabled', false);
    vscode.commands.executeCommand('setContext', 'etcdcluster.tlsauth', false);
    vscode.commands.executeCommand('setContext', 'etcd2.basicauth', false);
    vscode.commands.executeCommand('setContext', 'etcd2.basicauthroot', false);
  }

}
