import * as vscode from 'vscode';
import { EtcdExplorerBase, EtcdNode } from "./etcdExplorer"

var separator = "/";
var schema = "etcd3_value_text_schema"
const { Etcd3, AuthClient } = require('etcd3');
var fs = require('fs');

export class Etcd3Explorer extends EtcdExplorerBase implements vscode.TreeDataProvider<EtcdNode> {
  private _etcd3_options?: {
    hosts?: string,
    grpcOptions?: any,
    credentials?: any,
    auth?: {
      username: string,
      password: string
    }
  };
  constructor(_context: vscode.ExtensionContext) {
    super(schema, _context)
    this.initClient();
  }

  initClient() {
    super.initClient();
    if (!this.etcd_host) {
      return;
    }
    this._etcd3_options = {
      hosts: this.etcd_host,
      grpcOptions: {
        "grpc.max_receive_message_length": -1,
        "grpc.grpclb_call_timeout_ms": 600000,
      },
    }

    if (this.protocol && this.protocol == "https:") {
      var etcd3Credentials = {
        rootCertificate: this.host_options.ca,
        privateKey: this.host_options.key,
        certChain: this.host_options.cert
      }
      if (!etcd3Credentials.rootCertificate) {
        var conf = vscode.workspace.getConfiguration('etcd-explorer');
        if (conf.root_ca_path) {
          this.host_options.ca = fs.readFileSync(conf.root_ca_path);
          etcd3Credentials.rootCertificate = this.host_options.ca;
        }
      }
      this._etcd3_options.credentials = etcd3Credentials;
    }
    if (this.authentication && this.authentication.username && this.authentication.password) {
      this._etcd3_options.auth = {
        username: this.authentication.username,
        password: this.authentication.password
      }
    }


    this.client = new Etcd3(this._etcd3_options);
    this.isAuthEnabled();
    this.initAllData(this.RootNode(), this.jsonToLevelNodeList, true, true);
    console.log("Done .. nodes");
  }

  async isAuthEnabled() {
    if (this.client === undefined) return;
    var dummyusr = "ootsrysuxnoomileslorpraaemetvdsrpedyceutswnimdat";
    var dummypwd = "odymnayaetmslecotpdemareisissvxnwsrldteuopru";
    var options: any;
    if (this._etcd3_options) {
      options = {
        hosts: this._etcd3_options.hosts,
        grpcOptions: this._etcd3_options.grpcOptions,
        auth: {
          username: dummyusr,
          password: dummypwd
        }
      }
      if (this.protocol == "https:") {
        options = {
          hosts: this._etcd3_options.hosts,
          grpcOptions: this._etcd3_options.grpcOptions,
          credentials: this._etcd3_options.credentials,
          auth: {
            username: dummyusr,
            password: dummypwd
          }
        }
      }
    }
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
      vscode.commands.executeCommand('setContext', 'etcdcluster.tlsauth', false);
      var client = new Etcd3(options);
      client.auth.authenticate().then((resp: any) => {
        console.log(resp);
      }).catch((err: any) => {
        if (err && err.message) {
          if (err.message.includes("FAILED_PRECONDITION") && err.message.includes("authentication is not enabled")) {
            console.log("Auth is disabled");
            vscode.commands.executeCommand('setContext', 'etcd3.basicauth_enabled', false);
            this.authEnabled = false;
            this.setTreeViewTitleUser();
          }
          if (err.message.includes("authentication failed, invalid user ID or password")) {
            console.log("Auth is enabled");
            vscode.commands.executeCommand('setContext', 'etcd3.basicauth_enabled', true);
            this.authEnabled = true;
            if (this.authentication) {
              this.setTreeViewTitleUser(this.authentication.username, this.authentication.roles);
            }
            else {
              this.setTreeViewTitleUser();
            }
          }
        }
      });
    }
  }

  async enableAuth() {
    await this.client.auth.authEnable().then(async (resp: any) => {
      console.log(resp);
    }).catch(async (err: any) => {
      if (err && err.message) {
        //'9 FAILED_PRECONDITION: etcdserver: root user does not exist'
        if (err.message.includes("FAILED_PRECONDITION") && err.message.includes("root user does not exist")) {
          console.log("Creating root user.");
          var pwdBox = vscode.window.createInputBox();
          pwdBox.title = "Creating root user, please provide password for root user";
          pwdBox.password = true;
          pwdBox.onDidAccept(async () => {
            //pwdBox.hide();
            const rootUser = await this.client.user('root').create(pwdBox.value);
            await this.client.role('root').create();
            await rootUser.addRole('root');
            this.client.auth.authEnable().then(async (resp: any) => {
              console.log(resp);
            }).catch(async (err: any) => {
              await vscode.window.showErrorMessage(err.message);
            }).finally(() => { pwdBox.dispose(); });
          });
          pwdBox.show();
        }
        else {
          await vscode.window.showErrorMessage(err.message);
        }
      }
    }).finally(async () => {
      await this.isAuthEnabled();
      if (this.etcd_host) {
        this.refreshView(this.etcd_host);
      }
    });
  }

  async disableAuth() {
    await this.client.auth.authDisable().then(async (resp: any) => {
      console.log("Auth is disabled");
      this.authEnabled = false;
      this.logout();
    });
  }

  async loginas(user: string, pwd: string) {
    if (!this.etcd_host) return;
    if (this.client) this.client.close();
    var options: any;
    if (this._etcd3_options) {
      options = {
        hosts: this._etcd3_options.hosts,
        grpcOptions: this._etcd3_options.grpcOptions,
        auth: {
          username: user,
          password: pwd
        }
      }
      if (this.protocol == "https:") {
        options = {
          hosts: this._etcd3_options.hosts,
          grpcOptions: this._etcd3_options.grpcOptions,
          credentials: this._etcd3_options.credentials,
          auth: {
            username: user,
            password: pwd
          }
        }
      }
    }
    this.client = new Etcd3(options);
    if (!this.client) return;
    var roles: string[] = [];

    this.client.user(user).roles().then(async (res: any) => {
      if (res) {
        vscode.commands.executeCommand('setContext', 'etcd3.basicauth', true);
        for (var element of res) {
          roles.push(element.name);
          if (element.name == "root") {
            vscode.commands.executeCommand('setContext', 'etcd3.basicauthroot', true);
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
    }).catch((err: any) => {
      console.log(err);
    });
  }

  getTreeItem(element: EtcdNode): vscode.TreeItem {
    if (element.isLeafNode()) {
      element.command = { command: 'etcd-explorer.etcd3view.showvalue', title: "Show Value", arguments: [element], };
    }
    return element;
  }

  async deleteKeys(prefix: string) {
    return new Promise(async (resolve, reject) => {
      if (this.client === undefined) reject();
      if (prefix.endsWith(separator)) {
        const ns = this.client.namespace(prefix);
        await ns.delete().all().then((deleteResponse: any) => {
          if (deleteResponse.deleted == "0") {
            console.log(prefix + " failed to deleted [" + this.schema() + "]");
            reject();
          }
          else {
            console.log(prefix + " all deleted. " + " [" + this.schema() + "]");
            console.log(deleteResponse);
            resolve({});
          }
        }).catch((reason: string) => {
          console.log(reason + " [" + this.schema() + "]");
          reject();
        }); // deletes all keys with the prefix
      }
      else {
        this.client.delete().key(prefix).then((deleteResponse: any) => {
          if (deleteResponse.deleted == "0") {
            console.log(prefix + " failed to deleted [" + this.schema() + "]");
            reject();
          }
          else {
            console.log(prefix + " deleted." + " [" + this.schema() + "]");
            console.log(deleteResponse);
            resolve({});
          }
        }).catch((reason: string) => {
          console.log(reason + " [" + this.schema() + "]");
          reject();
        });
      }
    });
  }

  async initAllData(node: EtcdNode, callback: Function, ignoreParentKeys?: boolean, recursive?: boolean) {
    if (!this.isVisible) return;
    if (this.client === undefined) return;
    var prefix = node.prefix;
    var removePrefixFromKeys = (ignoreParentKeys != undefined) ? ignoreParentKeys : true;
    console.log("updating " + prefix);
    var nodeList = node.getChildren();

    if (!nodeList.canUpdate())
      return;

    nodeList.updating();

    var self = this;
    var promise_keys;
    if (prefix.endsWith(separator)) {
      promise_keys = this.client.getAll().prefix(prefix).strings();
    }
    else {
      promise_keys = this.client.get(prefix).string();
    }
    if (!promise_keys) return;
    promise_keys.then(async (data_val: any) => {
      var val = Object.create({});
      if (this.getType(data_val) == "string") {
        val[prefix] = data_val
      }
      else {
        val = data_val;
      }
      var jsonObj = Object.create({});
      for (var key of Object.keys(val)) {
        // remove prefix
        var childPart = removePrefixFromKeys ? key.replace(prefix, "") : key;
        if (childPart === undefined || childPart.length == 0) {
          node.setData(currentValue);
          continue;
        }
        childPart = childPart.replace(new RegExp(separator + '*$'), ""); // remove trailing seperators
        childPart = childPart.replace(new RegExp('^' + separator + '*'), ""); // remove leading seperators
        var childKeys = childPart.split(separator).reverse();
        var currentObj = jsonObj;
        var currentValue = val[key];
        while (childKeys.length > 0) {
          var childKey = childKeys.pop();
          if (childKey === undefined || childKey.length == 0)
            continue;
          if (childKeys.length > 0) { /* means its a dir*/
            var newObj = Object.create({});
            if (Object.getOwnPropertyNames(currentObj).indexOf(childKey) > -1) { /*currentObj has childKey*/ // /a=x /a/b=h
              if (self.isValueType(currentObj[childKey])) {
                // currentObj[childKey] is expected to be an object but it is not.
                currentObj[childKey] = [currentObj[childKey], newObj];
                newObj = currentObj[childKey][1];
              }
              else {
                newObj = currentObj[childKey];
                //currentParent = currentObj;
                //currentObjKey = childKey;
              }
            }
            else { // its a new dir object
              currentObj[childKey] = newObj;
            }
            currentObj = newObj;
          }
          else {
            if (Object.getOwnPropertyNames(currentObj).indexOf(childKey) > -1) { /*currentObj has childKey*/
              if (!self.isValueType(currentObj[childKey])) {
                // currentObj[childkey] is expected to be a value type but it is object.
                var chObj = currentObj[childKey];
                currentObj[childKey] = [currentValue, chObj];
              }
            }
            else {
              // childKey is a new addition to currentObj
              currentObj[childKey] = currentValue;
            }
          }
        }
      }

      await callback(jsonObj, node, self);
      nodeList.updated();
      self.refresh();
    }, (error: string) => {
      console.log(error);
      vscode.window.showErrorMessage("ETCD3: (prefix: " + prefix + " ) " + error.toString());
      nodeList.updated();
      self.refresh();
    });
  }

  async getValue(key: string): Promise<any> {
    var value: any;
    var error: any;
    this.client.get(key).string().then((val: string) => {
      value = val;
    }).catch((reason: string) => {
      error = reason;
    });

    return new Promise((resolve, reject) => {
      var timer = setInterval(() => {
        if (value != undefined || error != undefined || value == null) {
          clearInterval(timer);
          if (value == null) {
            reject("Value is null");
          }
          else if (!value && error)
            reject(error);
          else
            resolve(value);
        }
      }, 50);
    });
  }

  protected async write(key: string, value: any) {
    var self = this;
    var p = new Promise((resolve, reject) => {
      this.client.put(key).value(value).then(() => {
        console.log("Written key " + key + " [" + this.schema() + "]");
        resolve({});
      }).catch((reason: string) => {
        console.log("Error: writing key (" + key + ") " + reason + " [" + this.schema() + "]");
        reject(reason);
      });
    })
    return p;
  }

  resetContextValues() {
    vscode.commands.executeCommand('setContext', 'etcd3.basicauth_enabled', false);
    vscode.commands.executeCommand('setContext', 'etcdcluster.tlsauth', false);
    vscode.commands.executeCommand('setContext', 'etcd3.basicauth', false);
    vscode.commands.executeCommand('setContext', 'etcd3.basicauthroot', false);
  }
}
