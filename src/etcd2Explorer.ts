import * as vscode from 'vscode';
import { EtcdExplorerBase, EtcdNode } from "./etcdExplorer"
const Etcd2 = require('node-etcd');

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
    this.client = new Etcd2([this.etcd_host]);
    this.initAllData(this.RootNode(), this.jsonToLevelNodeList, true, true);
    console.log("Done .. nodes");
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

}
