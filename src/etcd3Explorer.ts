import * as vscode from 'vscode';
import { EtcdExplorerBase, EtcdNode } from "./etcdExplorer"

var separator = "/";
var schema = "etcd3_value_text_schema"
const { Etcd3 } = require('etcd3');

export class Etcd3Explorer extends EtcdExplorerBase implements vscode.TreeDataProvider<EtcdNode> {
  constructor() {
    super(schema)
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

  deleteKeys(prefix: string): Thenable<void> {
    return new Promise(async (resolve) => {
      if (this.client === undefined) return;
      const ns = this.client.namespace(prefix);
      await ns.delete().all(); // deletes all keys with the prefix
      resolve();
    });
  }

  initAllData(node: EtcdNode, callback: Function, ignoreParentKeys?: boolean, recursive?: boolean) {
    if (this.client === undefined) return;
    var prefix = node.prefix;
    var removePrefixFromKeys = (ignoreParentKeys != undefined) ? ignoreParentKeys : true;
    console.log("updating " + prefix);
    var nodeList = node.getChildren();

    if (nodeList.updatingNodes)
      return;
    nodeList.updatingNodes = true;

    var self = this;
    const promise_keys = this.client.getAll().prefix(prefix).strings();
    promise_keys.then((val: any) => {
      var jsonObj = Object.create({});
      for (var key in val) {
        // remove prefix
        var childPart = removePrefixFromKeys ? key.replace(prefix, "") : key;
        if (childPart === undefined || childPart.length == 0) {
          node.setValue(currentValue);
          continue;
        }
        var childKeys = childPart.split(separator);
        childKeys.reverse();
        var currentObj = jsonObj;
        var currentValue = val[key];
        while (childKeys.length > 0) {
          var childKey = childKeys.pop();
          if (childKey === undefined || childKey.length == 0)
            continue;
          if (childKeys.length > 0) {
            var newObj = Object.create({});
            if (Object.getOwnPropertyNames(currentObj).indexOf(childKey) > -1) {
              newObj = currentObj[childKey];
            }
            else {
              currentObj[childKey] = newObj;
            }
            currentObj = newObj;
          }
          else {
            currentObj[childKey] = currentValue;
          }
        }
      }

      callback(jsonObj, node);
      nodeList.updatingNodes = false;
      self.refresh();
    }, (error: string) => {
      console.log(error);
      vscode.window.showErrorMessage(error.toString());
      nodeList.updatingNodes = false;
      self.refresh();
    });
  }

  async getValue(key: string): Promise<any> {
    var value: any;
    value = this.client.get(key).string();
    return new Promise((resolve) => {
      var timer = setInterval(() => {
        if (value != undefined) {
          clearInterval(timer);
          resolve(value);
        }
      }, 50);
    });
  }

  protected write(key: string, value: any) {
    var self = this;
    this.client.put(key).value(value).then(() => { self.refreshData(); });
  }
}
