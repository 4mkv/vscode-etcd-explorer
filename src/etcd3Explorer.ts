import * as vscode from 'vscode';
import { EtcdExplorerBase, EtcdNode } from "./etcdExplorer"

var separator = "/";
var schema = "etcd3_value_text_schema"
const { Etcd3 } = require('etcd3');

export class Etcd3Explorer extends EtcdExplorerBase implements vscode.TreeDataProvider<EtcdNode> {
  constructor(_context: vscode.ExtensionContext) {
    super(schema, _context)
    this.initClient();
  }

  initClient() {
    super.initClient();
    if (!this.etcd_host) {
      return;
    }
    this.client = new Etcd3({ hosts: this.etcd_host, grpcOptions: { "grpc.max_receive_message_length": -1, "grpc.grpclb_call_timeout_ms": 600000, }, });
    this.initAllData(this.RootNode(), this.jsonToLevelNodeList, true, true);
    console.log("Done .. nodes");
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
            resolve();
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
            resolve();
          }
        }).catch((reason: string) => {
          console.log(reason + " [" + this.schema() + "]");
          reject();
        });
      }
    });
  }

  async initAllData(node: EtcdNode, callback: Function, ignoreParentKeys?: boolean, recursive?: boolean) {
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
      vscode.window.showErrorMessage(error.toString());
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
        resolve();
      }).catch((reason: string) => {
        console.log("Error: writing key (" + key + ") " + reason + " [" + this.schema() + "]");
        reject(reason);
      });
    })
    return p;
  }
}
