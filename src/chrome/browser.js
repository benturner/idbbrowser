/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

const DEBUG = false;

const INDEXEDDB_FILE_FILTER = "*.sqlite";

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(window, "Services",
  "resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(window, "IDBBrowserHelper",
  "resource://idbbrowser/modules/IDBBrowserHelper.jsm");

XPCOMUtils.defineLazyModuleGetter(window, "Task",
  "resource://gre/modules/Task.jsm");

XPCOMUtils.defineLazyGetter(window, "Promise", function() {
  let temp = {};
  try {
    Cu.import("resource://gre/modules/Promise.jsm", temp);
  } catch(e) {
    Cu.import("resource://gre/modules/commonjs/sdk/core/promise.js", temp);
  }
  return temp.Promise;
});

XPCOMUtils.defineLazyModuleGetter(window, "Sqlite",
  "resource://gre/modules/Sqlite.jsm");

XPCOMUtils.defineLazyModuleGetter(window, "OS",
  "resource://gre/modules/osfile.jsm");

function log(msg) {
  msg = "IDBBrowser:browser.js: " + msg;
  Services.console.logStringMessage(msg);
  dump(msg + "\n");
}

function deferThrow(exception) {
  setTimeout(function() { throw exception; }, 0);
}

function makeDeferred() {
  let deferred = Promise.defer();
  let accept = "accept" in deferred ? deferred["accept"] : deferred["resolve"];
  return { promise: deferred.promise,
           accept: accept,
           reject: deferred.reject };
}

// Returns Promise<bool> saying whether the directory was created or not.
function makeDir(path) {
  let { promise, accept, reject } = makeDeferred();
  OS.File.makeDir(path).then(result => {
    accept(true);
  },
  reason => {
    if (reason && reason instanceof OS.File.Error && reason.becauseExists) {
      accept(false);
    } else {
      reject(reason);
    }
  });
  return promise;
}

// Returns Promise<void>.
function recursiveCopy(srcDir, destDir) {
  return Task.spawn(function() {
    let srcInfo;

    try {
      srcInfo = yield OS.File.stat(srcDir);
    } catch (e if e instanceof OS.File.Error && e.becauseNoSuchFile) {
      // Nothing to do if the source directory doesn't exist.
      return;
    }

    if (!srcInfo.isDir) {
      throw new Error("'" + srcDir + "' is not a directory!");
    }

    yield makeDir(destDir);

    let iterator = new OS.File.DirectoryIterator(srcDir);
    try {
      yield iterator.forEach(entry => {
        let targetPath = OS.Path.join(destDir, entry.name);
        return entry.isDir ?
               recursiveCopy(entry.path, targetPath):
               OS.File.copy(entry.path, targetPath);
      });
    }
    finally {
      iterator.close();
    }
  });
}

// Returns Promise<void>.
function recursiveDelete(srcDir) {
  return Task.spawn(function() {
    let srcInfo;

    try {
      srcInfo = yield OS.File.stat(srcDir);
    } catch (e if e instanceof OS.File.Error && e.becauseNoSuchFile) {
      // Nothing to do if the source directory doesn't exist.
      return;
    }

    if (!srcInfo.isDir) {
      throw new Error("'" + srcDir + "' is not a directory!");
    }

    let iterator = new OS.File.DirectoryIterator(srcDir);
    try {
      yield iterator.forEach(entry => {
        return entry.isDir ?
               recursiveDelete(entry.path) :
               OS.File.remove(entry.path);
      });
    }
    finally {
      iterator.close();
    }

    yield OS.File.removeEmptyDir(srcDir);
  });
}

function addProperty(element, property) {
  let properties;
  if (element.hasAttribute("properties")) {
    properties = element.getAttribute("properties") + " " + property;
  } else {
    properties = property;
  }
  element.setAttribute("properties", properties);
}

function removeProperty(element, property) {
  if (!element.hasAttribute("properties")) {
    return;
  }
  let properties = element.getAttribute("properties");
  properties = properties.replace(property, "").replace(/^\s+|\s+$/g, "");
  element.setAttribute("properties", properties);
}

function IndexMetadata(index) {
  this._name = index.name;
  this._keyPath = JSON.stringify(index.keyPath);
  this._unique = index.unique;
  this._multiEntry = index.multiEntry;
}
IndexMetadata.prototype = {
  get type() {
    return "IDBIndex";
  },
  get name() {
    return this._name;
  },
  get keyPath() {
    return JSON.parse(this._keyPath);
  },
  get unique() {
    return this._unique;
  },
  get multiEntry() {
    return this._multiEntry;
  },
  getDisplay: function() {
    let keyPath = this.keyPath;
    if (typeof(keyPath) != "string" && keyPath !== null) {
      keyPath = "JSON: " + keyPath;
    }
    return {
      type: this.type,
      keyPath: keyPath,
      unique: this.unique,
      multiEntry: this.multiEntry
    };
  }
};

function ObjectStoreMetadata(objectStore) {
  this._name = objectStore.name;
  this._keyPath = JSON.stringify(objectStore.keyPath);
  this._autoIncrement = objectStore.autoIncrement;
  this._indexes = [];

  for (let i = 0; i < objectStore.indexNames.length; i++) {
    let index = objectStore.index(objectStore.indexNames[i]);
    this._indexes.push(new IndexMetadata(index));
  }
}
ObjectStoreMetadata.prototype = {
  get type() {
    return "IDBObjectStore";
  },
  get name() {
    return this._name;
  },
  get keyPath() {
    return JSON.parse(this._keyPath);
  },
  get autoIncrement() {
    return this._autoIncrement;
  },
  get indexes() {
    return this._indexes;
  },
  getDisplay: function() {
    let keyPath = this.keyPath;
    if (typeof(keyPath) != "string" && keyPath !== null) {
      keyPath = "JSON: " + keyPath;
    }
    return {
      type: this.type,
      keyPath: keyPath,
      autoIncrement: this.autoIncrement,
    };
  },
  getIndexMetadata: function(name) {
    for (let i in this._indexes) {
      let indexMetadata = this._indexes[i];
      if (indexMetadata.name == name) {
        return indexMetadata;
      }
    }
    return null;
  }
};

function DatabaseMetadata(origin, db) {
  this._origin = origin;
  this._name = db.name;
  this._version = db.version;
  this._objectStores = [];

  if (db.objectStoreNames.length) {
    let transaction = db.transaction(db.objectStoreNames, "readonly");

    for (let i = 0; i < transaction.objectStoreNames.length; i++) {
      let objectStore =
        transaction.objectStore(transaction.objectStoreNames[i]);
      this._objectStores.push(new ObjectStoreMetadata(objectStore));
    }
  }
};
DatabaseMetadata.prototype = {
  get type() {
    return "IDBDatabase";
  },
  get origin() {
    return this._origin;
  },
  get name() {
    return this._name;
  },
  get version() {
    return this._version;
  },
  get objectStores() {
    return this._objectStores;
  },
  getDisplay: function() {
    return {
      type: this.type,
      version: this.version,
    };
  },
  getObjectStoreMetadata: function(name) {
    for (let i in this._objectStores) {
      let objectStoreMetadata = this._objectStores[i];
      if (objectStoreMetadata.name == name) {
        return objectStoreMetadata;
      }
    }
    return null;
  }
};


function TreeView() {
  this._data = [];
}
TreeView.prototype = {
  _rowCount: 0,
  _selection: null,
  _treeBox: null,
  _data: null,
  _firstDirtyIndex: -1,
  _flushTimeout: null,
  _canceled: false,

  // nsITreeView
  get rowCount() {
    return this._rowCount;
  },

  get selection() {
    return this._selection;
  },
  set selection(val) {
    return this._selection = val;
  },

  getRowProperties: function(index) {
    if (index >= this._data.length) {
      return "loading";
    }
    return null;
  },

  getColumnProperties: function(column) {
    return null;
  },

  getCellProperties: function(index, column) {
    let rowProperties = this.getRowProperties(index);
    let columnProperties = this.getColumnProperties(column);
    if (rowProperties) {
      if (columnProperties) {
        return rowProperties + " " + columnProperties;
      }
      return rowProperties;
    } else if (columnProperties) {
      return columnProperties;
    }
    return null;
  },

  isContainer: function(index) {
    return false;
  },

  isContainerOpen: function(index) {
    return false;
  },

  isContainerEmpty: function(index) {
    return true;
  },

  isSeparator: function(index) {
    return false;
  },

  isSorted: function(index) {
    return false;
  },

  canDrop: function(targetIndex, orientation, dataTransfer) {
    return false;
  },

  drop: function(dropIndex, orientation, dataTransfer) {
  },

  getParentIndex: function(index) {
  },

  hasNextSibling: function(parentIndex, index) {
  },

  getLevel: function(index) {
    return 0;
  },

  getImageSrc: function(index, column) {
    return null;
  },

  getProgressMode: function(index, column) {
    return Ci.nsITreeView.PROGRESS_NONE;
  },

  getCellValue: function(index, column) {
    return this.getCellText(index, column);
  },

  getCellText: function(index, column) {
    if (index >= this._data.length) {
      if (column.index == 0) {
        return this._canceled ? "<Canceled>" : "<Loading...>";
      }
      return "";
    }
    return this._data[index][column.element.getAttribute("anonid")];
  },

  setTree: function(treeBox) {
    this._treeBox = treeBox;
  },

  toggleOpenState: function(index) {
  },

  cycleHeader: function(column) {
  },

  selectionChanged: function() {
  },

  cycleCell: function(index, column) {
  },

  isEditable: function(index, column) {
    return column.editable;
  },

  isSelectable: function(index, column) {
    return column.selectable;
  },

  setCellValue: function(index, column, value) {
  },

  setCellText: function(index, column, text) {
  },

  performAction: function(action) {
  },

  performActionOnRow: function(action, index) {
  },

  performActionOnCell: function(action, index, column) {
  },

  // Not part of nsITreeView.
  get treeBox() {
    return this._treeBox;
  },

  clear: function() {
    let removedCount = this.rowCount * -1;
    this._data = [];
    this._rowCount = 0;
    this._canceled = false;
    this.treeBox.rowCountChanged(0, removedCount);
  },

  changeRowCount: function(index, count) {
    this._rowCount += count;
    this.treeBox.rowCountChanged(index, count);
  },

  pushRowData: function(data) {
    let dirtyRowIndex = this._data.length;
    this._data.push(data);

    if (!this._flushTimeout) {
      this._firstDirtyIndex = dirtyRowIndex;
      this._flushTimeout = setTimeout(this.invalidateDirtyRows.bind(this), 100);
    }
  },

  invalidateDirtyRows: function() {
    if (this._flushTimeout) {
      clearTimeout(this._flushTimeout);
      this._flushTimeout = 0;
    }
    if (this._firstDirtyIndex != -1) {
      this.treeBox.invalidateRange(this._firstDirtyIndex,
                                   this._data.length - 1);
      this._firstDirtyIndex = -1;
    }
  },

  cancel: function() {
    this._canceled = true;
  }
};

const BrowserController = {
  _stringBundle: null,
  _loadedDatabases: { },
  _currentMetadataRequestSerial: 0,
  _currentDataRequestSerial: 0,
  _dataTreeView: null,
  _lastLoadedTreeCell: null,
  _capturedCell: null,
  _hoveredCell: null,
  _loadingCell: null,

  load: function() {
    if (DEBUG) log("onload");

    window.onerror = this._errorHandler.bind(this);

    this._stringBundle = document.getElementById("stringbundle");

    this._dataTreeView = new TreeView();
    document.getElementById("tree-data").view = this._dataTreeView;

    if (!this._supportsOpenWithFile()) {
      document.getElementById("command-open").setAttribute("disabled", "true");
      document.getElementById("command-open").setAttribute("hidden", "true");
    }

    Task.spawn(function() {
      yield this._sanitizeProfile();
      let profileFiles = yield this._getProfileFiles();
      this._buildProfileFilesTree(profileFiles);
    }.bind(this)).then(null, deferThrow);
  },

  openDatabase: function() {
    if (DEBUG) log("openDatabase");

    let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window, this._stringBundle.getString("openFile.title"),
            Ci.nsIFilePicker.modeOpen);

    fp.appendFilter(this._stringBundle.getString("indexedDB-file-filter.title"),
                    INDEXEDDB_FILE_FILTER);
    fp.appendFilters(Ci.nsIFilePicker.filterAll);

    fp.open(function(result) {
      if (result != Ci.nsIFilePicker.returnCancel) {
        this._buildCustomFileTree(fp.file);
      }
    }.bind(this));
  },

  importDatabase: function() {
    if (DEBUG) log("importDatabase");

    let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window, this._stringBundle.getString("importFile.title"),
            Ci.nsIFilePicker.modeOpen);

    fp.appendFilter(this._stringBundle.getString("indexedDB-file-filter.title"),
                    INDEXEDDB_FILE_FILTER);
    fp.appendFilters(Ci.nsIFilePicker.filterAll);

    fp.open(function(result) {
      if (result != Ci.nsIFilePicker.returnCancel) {
        this._importDatabaseIntoProfile(fp.file);
      }
    }.bind(this));
  },

  newWindow: function() {
    if (DEBUG) log("newWindow");

    IDBBrowserHelper.openNewBrowser();
  },

  exit: function() {
    if (DEBUG) log("exit");

    window.close();
  },

  handleNavSelect: function(event) {
    if (DEBUG) log("handleNavSelect");

    if (!("view" in event.target)) {
      return;
    }

    this._clearMetadataDisplay();

    let view = event.target.view;

    let rowIndex = view.selection.currentIndex;
    if (rowIndex < 0) {
      return;
    }

    let element = view.getItemAtIndex(rowIndex);

    let [ key, isIDBKey ] = this._getKeyFromElement(element);
    if (!key || key.length < 2) {
      return;
    }

    if (key.length == 2) {
      this._handleDatabaseSelect(element, key, isIDBKey);
      return;
    }

    let dbMetadata = this._loadedDatabases[key[0]][key[1]];

    let itemMetadata = dbMetadata.getObjectStoreMetadata(key[2]);
    if (key.length == 4) {
      itemMetadata = itemMetadata.getIndexMetadata(key[3]);
    }

    this._populateMetadataDisplay(itemMetadata.getDisplay());
  },

  handleNavClick: function(event) {
    if (DEBUG) log("handleNavClick");

    let tree = document.getElementById("tree-nav");

    let cell = this._cellFromMouseEvent(event, tree);
    if (cell) {
      let properties = cell.getAttribute("properties");
      if (properties.indexOf("button") != -1 &&
          (properties.indexOf("objectStore") != -1 ||
           properties.indexOf("index") != -1)) {
        this._beginLoad(cell, properties);
      }
    }
  },

  handleNavKeypress: function(event) {
    if (event.keyCode == KeyEvent.DOM_VK_RETURN) {
      let tree = document.getElementById("tree-nav");
      let view = tree.view;

      let rowIndex = view.selection.currentIndex;
      if (rowIndex >= 0) {
        let item = view.getItemAtIndex(rowIndex);

        let [ key, isIDBKey ] = this._getKeyFromElement(item);
        if (key && key.length > 2) {
          let cell = item.firstChild.firstChild.nextElementSibling;
          if (cell) {
            this._beginLoad(cell);
          }
        }
      }
    }
  },

  handleNavMousedown: function(event) {
    let tree = document.getElementById("tree-nav");

    let cell = this._cellFromMouseEvent(event, tree);
    if (cell) {
      addProperty(cell, "cell-active");
      this._capturedCell = cell;
      tree.setCapture();
    }
  },

  handleNavMouseup: function(event) {
    if (this._capturedCell) {
      removeProperty(this._capturedCell, "cell-active");
      this._capturedCell = null;
    }

    this.handleNavMousemove(event);
  },

  handleNavMousemove: function(event) {
    if (this._capturedCell) {
      return;
    }

    let cell = this._cellFromMouseEvent(event);
    if (this._hoveredCell == cell) {
      return;
    }

    if (this._hoveredCell) {
      removeProperty(this._hoveredCell, "cell-hover");
      this._hoveredCell = null;
    }

    if (cell) {
      addProperty(cell, "cell-hover");
      this._hoveredCell = cell;
    }
  },

  handleNavMouseleave: function(event) {
    if (this._capturedCell) {
      return;
    }

    if (this._hoveredCell) {
      removeProperty(this._hoveredCell, "cell-hover");
      this._hoveredCell = null;
    }
  },

  _getKeyFromElement: function(element) {
    let isIDBKey;
    let key;
    if (element.hasAttribute("data-idb-key")) {
      isIDBKey = true;
      key = element.getAttribute("data-idb-key");
    } else if (element.hasAttribute("data-file-key")) {
      isIDBKey = false;
      key = element.getAttribute("data-file-key");
    } else {
      return [];
    }
    return [ JSON.parse(key), isIDBKey ];
  },

  _errorHandler: function(message, filename, lineNumber) {
    alert(message + "' (" + filename + ":" + lineNumber + ")");
  },

  _buildProfileFilesTree: function(infoPairs) {
    if (DEBUG) log("_buildProfileFilesTree");

    if (!infoPairs.length) {
      let statusCell = document.getElementById("treecell-status");
      let label = this._stringBundle.getString("nav-tree.no-files");
      statusCell.setAttribute("label", label);
      return;
    }

    let statusItem = document.getElementById("treeitem-status");
    statusItem.setAttribute("hidden", "true");

    let originItems = [];

    let currentOrigin;
    let currentChildrenElement;

    for (let i in infoPairs) {
      let infoPair = infoPairs[i];
      let idbKey = [ infoPair.origin, infoPair.name ];

      if (infoPair.origin != currentOrigin) {
        let item = document.createElement("treeitem");
        item.setAttribute("container", "true");
        item.setAttribute("data-idb-key", JSON.stringify([ infoPair.origin ]));
        originItems.push(item);

        let row = document.createElement("treerow");
        item.appendChild(row);

        let cell = document.createElement("treecell");
        cell.setAttribute("label", infoPair.origin);
        cell.setAttribute("properties", "origin");
        row.appendChild(cell);

        let children = document.createElement("treechildren");
        item.appendChild(children);

        currentOrigin = infoPair.origin;
        currentChildrenElement = children;
      }

      let item = document.createElement("treeitem");
      item.setAttribute("data-idb-key", JSON.stringify(idbKey));
      currentChildrenElement.appendChild(item);

      let row = document.createElement("treerow");
      item.appendChild(row);

      let cell = document.createElement("treecell");
      cell.setAttribute("label", infoPair.name);
      cell.setAttribute("properties", "database unloaded");
      row.appendChild(cell);
    }

    let profileElement = document.getElementById("treechildren-profile");

    for (let i in originItems) {
      profileElement.appendChild(originItems[i]);
    }
  },

  _clearMetadataDisplay: function() {
    if (DEBUG) log("_clearMetadataDisplay");

    let listElement = document.getElementById("listbox-metadata");
    listElement.setAttribute("disabled", "true");

    while (listElement.getRowCount()) {
      listElement.removeItemAt(0);
    }
  },

  _populateMetadataDisplay: function(metadata) {
    if (DEBUG) log("_populateMetadataDisplay");

    let listElement = document.getElementById("listbox-metadata");

    for (let key in metadata) {
      let row = document.createElement("listitem");

      let cell = document.createElement("listcell");
      cell.setAttribute("label", key);
      cell.setAttribute("value", key);

      row.appendChild(cell);

      cell = document.createElement("listcell");
      cell.setAttribute("label", metadata[key]);
      cell.setAttribute("value", metadata[key]);

      row.appendChild(cell);

      listElement.appendChild(row);
    }

    listElement.removeAttribute("disabled");
  },

  _handleDatabaseSelect: function(treeItemElement, key, isIDBKey) {
    if (DEBUG) log("_handleDatabaseSelect");

    if ((key[0] in this._loadedDatabases) &&
        (key[1] in this._loadedDatabases[key[0]])) {
      let dbData = this._loadedDatabases[key[0]][key[1]];
      this._populateMetadataDisplay(dbData.getDisplay());
      return;
    }

    let requestSerial = ++this._currentMetadataRequestSerial;

    let request = isIDBKey ?
                  this._openWithOrigin(key[0], key[1]) :
                  this._openWithFile(OS.Path.join(key[0], key[1]));
    request.onsuccess = function(event) {
      let db = event.target.result;

      let dbData = new DatabaseMetadata(key[0], db);
      db.close();

      if (!(key[0] in this._loadedDatabases)) {
        this._loadedDatabases[key[0]] = {};
      }
      this._loadedDatabases[key[0]][key[1]] = dbData;

      this._buildDatabaseTree(treeItemElement, dbData, key, isIDBKey);

      if (this._currentMetadataRequestSerial == requestSerial) {
        this._populateMetadataDisplay(dbData.getDisplay());
      }
    }.bind(this);
    request.onerror = function(event) {
      throw new Error(event.target.error.name);
    };
  },

  _buildDatabaseTree: function(treeItemElement, dbData, key, isIDBKey) {
    if (DEBUG) log("_buildDatabaseTree");

    // First update style on treecell.
    let treecell = treeItemElement.firstChild.firstChild;
    removeProperty(treecell, "unloaded");

    if (!dbData.objectStores.length) {
      return;
    }

    treeItemElement.setAttribute("container", "true");
    treeItemElement.setAttribute("open", "true");

    let dbChildren = document.createElement("treechildren");

    for (let i in dbData.objectStores) {
      let osData = dbData.objectStores[i];
      let idbKey = JSON.stringify([ key[0], key[1], osData.name ]);
      let hasIndexes = !!osData.indexes.length;

      let item = document.createElement("treeitem");
      item.setAttribute(isIDBKey ? "data-idb-key" : "data-file-key", idbKey);
      if (hasIndexes) {
        item.setAttribute("container", "true");
      }
      dbChildren.appendChild(item);

      let row = document.createElement("treerow");
      item.appendChild(row);

      let cell = document.createElement("treecell");
      cell.setAttribute("label", osData.name);
      cell.setAttribute("properties", "objectStore");
      row.appendChild(cell);

      cell = document.createElement("treecell");
      cell.setAttribute("properties", "button objectStore");
      row.appendChild(cell);

      if (hasIndexes) {
        let objectStoreChildren = document.createElement("treechildren");
        item.appendChild(objectStoreChildren);

        for (let j in osData.indexes) {
          let idxData = osData.indexes[j];
          let idbKey =
            JSON.stringify([ key[0], key[1], osData.name, idxData.name ]);

          let item = document.createElement("treeitem");
          item.setAttribute(isIDBKey ? "data-idb-key" : "data-file-key",
                            idbKey);
          objectStoreChildren.appendChild(item);

          let row = document.createElement("treerow");
          item.appendChild(row);

          let cell = document.createElement("treecell");
          cell.setAttribute("label", idxData.name);
          cell.setAttribute("properties", "index");
          row.appendChild(cell);

          cell = document.createElement("treecell");
          cell.setAttribute("properties", "button index");
          row.appendChild(cell);
        }
      }
    }

    treeItemElement.appendChild(dbChildren);
  },

  _populateDataTree: function(key, isIDBKey) {
    if (DEBUG) log("_populateDataTree");

    const textSeparator = "   \xBB   ";

    let isIndex = key.length > 3;

    let idbURL = isIDBKey ?
                 key[0] + textSeparator + key[1] + textSeparator + key[2] :
                 key[1] + textSeparator + key[2];

    if (isIndex) {
      idbURL += textSeparator + key[3];
    }

    let dataTree = document.getElementById("tree-data");
    dataTree.removeAttribute("disabled");

    let dataDesc = document.getElementById("description-data");
    dataDesc.setAttribute("value", idbURL);

    let rowCountDesc = document.getElementById("description-rowCount");
    rowCountDesc.setAttribute("value", "");

    let treeView = this._dataTreeView;
    treeView.clear();

    let primaryKeyCol = document.getElementById("treecol-primaryKey");
    if (isIndex) {
      primaryKeyCol.removeAttribute("hidden");
    } else {
      primaryKeyCol.setAttribute("hidden", "true");
    }

    let objectStoreName = key[2];
    let indexName = isIndex ? key[3] : null;

    let requestSerial = ++this._currentDataRequestSerial;

    let request = isIDBKey ?
                  this._openWithOrigin(key[0], key[1]) :
                  this._openWithFile(OS.Path.join(key[0], key[1]));
    request.onsuccess = function(event) {
      let db = event.target.result;

      if (this._currentDataRequestSerial != requestSerial) {
        db.close();
        return;
      }

      let transaction = db.transaction(objectStoreName, "readonly");
      transaction.oncomplete = event => {
        this._endLoad(false);
      }

      let source = transaction.objectStore(objectStoreName);
      if (isIndex) {
        source = source.index(indexName);
      }

      source.count().onsuccess = function (event) {
        if (this._currentDataRequestSerial != requestSerial) {
          db.close();
          return;
        }

        let count = event.target.result;

        rowCountDesc.setAttribute("value", count);

        if (count) {
          treeView.changeRowCount(0, count);
        }
      }.bind(this);

      source.openCursor().onsuccess = function(event) {
        let cursor = event.target.result;

        if (this._currentDataRequestSerial != requestSerial) {
          db.close();
          return;
        }

        if (!cursor) {
          treeView.invalidateDirtyRows();
          db.close();
          return;
        }

        let data = isIndex ?
                    [ BrowserController._keyToDisplayText(cursor.key),
                      BrowserController._keyToDisplayText(cursor.primaryKey),
                      BrowserController._valueToDisplayText(cursor.value) ] :
                    [ BrowserController._keyToDisplayText(cursor.key),
                      undefined,
                      BrowserController._valueToDisplayText(cursor.value) ];
        treeView.pushRowData(data);

        cursor.continue();
      }.bind(this);
    }.bind(this);
    request.onerror = function(event) {
      this._endLoad(true);
      throw new Error(event.target.error.name);
    }.bind(this);
  },

  _buildCustomFileTree: function(file) {
    if (DEBUG) log("_buildCustomFileTree");

    let navTreeChildren = document.getElementById("treechildren-nav");
    let navTreeItems = navTreeChildren.children;

    let targetTreeChildren = navTreeChildren;

    for (let i = 0; i < navTreeItems.length; i++) {
      let item = navTreeItems[i];
      if (!item.hasAttribute("data-file-key")) {
        continue;
      }
      let fileKey = JSON.parse(item.getAttribute("data-file-key"));

      if (fileKey[0] == file.parent.path) {
        // Found directory already.
        targetTreeChildren = item.firstChild.nextElementSibling;
        break;
      }
    }

    if (targetTreeChildren == navTreeChildren) {
      // Didn't find directory, make a new one.
      let item = document.createElement("treeitem");
      item.setAttribute("data-file-key", JSON.stringify([ file.parent.path ]));
      item.setAttribute("container", "true");
      item.setAttribute("open", "true");

      targetTreeChildren.appendChild(item);

      let row = document.createElement("treerow");
      item.appendChild(row);

      let cell = document.createElement("treecell");
      cell.setAttribute("label", file.parent.leafName);
      cell.setAttribute("properties", "folder");
      row.appendChild(cell);

      targetTreeChildren = document.createElement("treechildren");
      item.appendChild(targetTreeChildren);
    }

    let fileKey = [ file.parent.path, file.leafName ];

    let item = document.createElement("treeitem");
    item.setAttribute("data-file-key", JSON.stringify(fileKey));
    targetTreeChildren.appendChild(item);

    let row = document.createElement("treerow");
    item.appendChild(row);

    let cell = document.createElement("treecell");
    cell.setAttribute("label", file.leafName);
    cell.setAttribute("properties", "database unloaded");
    row.appendChild(cell);
  },

  _importDatabaseIntoProfile: function(file) {
    if (DEBUG) log("_importDatabaseIntoProfile");

    if (file.leafName.substring(file.leafName.lastIndexOf(".")) != ".sqlite") {
      if (DEBUG) log("Not importing '" + file.path + "'");
      let { promise, accept } = makeDeferred();
      accept();
      return promise;
    }

    let idbPath = OS.Path.join(OS.Constants.Path.profileDir, "indexedDB");
    let dbPath = OS.Path.join(idbPath, "chrome", "idb", file.leafName);

    Task.spawn(function() {
      let currentPath = OS.Path.join(idbPath, "chrome");
      let fileManagerName =
        file.leafName.substring(0, file.leafName.lastIndexOf("."));

      // Make sure that the selected database is actually an indexedDB database.
      let dbName = yield BrowserController._getNameFromDatabaseFile(file.path);

      // See if the target path already exists.
      if (yield OS.File.exists(dbPath)) {
        // Ask if the database should be overwritten.
        let title =
          BrowserController._stringBundle.getString("importOverwrite.title");
        let prompt =
          BrowserController._stringBundle.getString("importOverwrite.prompt");
        let result = Cc["@mozilla.org/embedcomp/prompt-service;1"].
                     getService(Ci.nsIPromptService).
                     confirm(window, title, prompt);
        if (!result) {
          // Don't overwrite, just bail without changing the nav tree.
          throw new Task.Result();
        }

        // Delete the old database and all the files in its file directory.
        yield OS.File.remove(dbPath);
        yield recursiveDelete(OS.Path.join(currentPath, "idb",
                                           fileManagerName));
      }

      // Make the directory structure if it doesn't already exist.
      let created = yield makeDir(currentPath);
      if (created) {
        // The ".metadata" file is a marker for folder upgrade introduced in
        // Firefox 22.
        let metadata =
          yield OS.File.open(OS.Path.join(currentPath, ".metadata"),
                             { create: true });
        yield metadata.close();
      }

      currentPath = OS.Path.join(currentPath, "idb");
      yield makeDir(currentPath);

      // Make the directory for files.
      let fileManagerPath = OS.Path.join(currentPath, fileManagerName);
      yield makeDir(fileManagerPath);

      // Copy all the files.
      let origFileManagerPath = OS.Path.join(file.parent.path, fileManagerName);
      yield recursiveCopy(origFileManagerPath, fileManagerPath);

      // Finally copy the actual database.
      yield OS.File.copy(file.path, OS.Path.join(currentPath, file.leafName));

      throw new Task.Result(dbName);
    }).then(result => {
      // Rebuild
      if (typeof(result) == "string") {
        BrowserController._insertImportedDatabaseTreeItem(result);
      }
    }, deferThrow);
  },

  _getProfileFiles: function() {
    if (DEBUG) log("getProfileFiles");

    let directory = OS.Path.join(OS.Constants.Path.profileDir, "indexedDB");
    if (DEBUG) log("Searching profile folder: " + directory);

    return Task.spawn(function() {
      let results = [];

      let dirIterator = new OS.File.DirectoryIterator(directory);
      try {
        yield dirIterator.forEach(originDir => {
          let origin =
            BrowserController._originFromSanitizedDirectory(originDir.name);
          if (DEBUG) log("Examining origin: " + origin);

          let idbDirectory = OS.Path.join(originDir.path, "idb");

          return Task.spawn(function() {
            if (!(yield OS.File.exists(idbDirectory))) {
              return;
            }
            let fileIterator =
              new OS.File.DirectoryIterator(idbDirectory);
            try {
              yield fileIterator.forEach(file => {
                // Skip directories.
                if (file.isDir) {
                  return;
                }

                // Skip any non-sqlite files.
                if (file.name.substring(file.name.lastIndexOf(".")) !=
                    ".sqlite") {
                  return;
                }

                return BrowserController._getNameFromDatabaseFile(file.path)
                                        .then(name => {
                  results.push({ origin: origin, name: name });
                });
              });
            }
            finally {
              fileIterator.close();
            }
          });
        });
      } catch(e if e instanceof OS.File.Error && e.becauseNoSuchFile) {
        // Nothing to do here.
      } finally {
        dirIterator.close();
      }

      results.sort(function(a, b) {
        if (a.origin == "chrome" && b.origin != "chrome") {
          return -1;
        }
        if (a.origin != "chrome" && b.origin == "chrome") {
          return 1;
        }
        if (a.origin < b.origin) {
          return -1;
        }
        if (a.origin > b.origin) {
          return 1;
        }
        if (a.name < b.name) {
          return -1;
        }
        if (a.name > b.name) {
          return 1;
        }
        return 0;
      });

      throw new Task.Result(results);
    });
  },

  _originFromSanitizedDirectory: function(name) {
    let components = name.split("+");
    if (components.length == 1) {
      return name;
    }

    let origin = "";

    // Check for appId.
    let match = components[0].match(/\d+/);
    if (match && match[0] == components[0]) {
      // Prepend appId + browser flag.
      origin += components[0] + "+" + components[1] + "+";
      components.splice(0, 2);
    }

    // Strip empty components. This may not work correctly all the time.
    components = components.filter(function(s) { return !!s; });

    let isFile = components[0] == "file";

    // Take care of protocol.
    origin += components[0] + "://";
    components.splice(0, 1);

    if (isFile) {
      origin += "/";

      if ("winGetDrive" in OS.Path) {
        // On Windows, first component should be drive letter.
        origin += components[0] + ":/";
        components.splice(0, 1);
      }

      origin += components.join("/");
    } else {
      // Check for port.
      let port;
      match = components[components.length - 1].match(/\d+/);
      if (match && match[0] == components[components.length - 1]) {
        port = match[0];
        components.splice(components.length - 1, 1);
      }

      origin += components.join("");

      if (port) {
        origin += ":" + port;
      }
    }

    return origin;
  },

  _getNameFromDatabaseFile: function(path) {
    return Task.spawn(function() {
      if (DEBUG) log("Opening '" + path + "'");

      let connection = yield Sqlite.openConnection({ path: path });

      let rows = yield connection.execute("SELECT name FROM database");
      if (rows.length != 1) {
        throw new Error("'database' table has " + rows.length + " rows");
      }

      let name = rows[0].getResultByName("name");

      yield connection.close();

      if (DEBUG) log("Determined database name '" + name + "'");
      throw new Task.Result(name);
    });
  },

  _ensureIndexedDB: function() {
    if (!("indexedDB" in window)) {
      let idbManager = Cc["@mozilla.org/dom/indexeddb/manager;1"].
                       getService(Ci.nsIIndexedDatabaseManager);
      idbManager.initWindowless(window);
    }
  },

  _openWithOrigin: function(origin, name, version) {
    if (DEBUG) log("_openWithOrigin");

    this._ensureIndexedDB();

    let principal;

    if (origin == "chrome") {
      principal = Services.scriptSecurityManager.getSystemPrincipal();
    } else {
      let uri = Services.io.newURI(origin, null, null);
      principal = Services.scriptSecurityManager.getCodebasePrincipal(uri);
    }

    return version == undefined ?
           indexedDB.openForPrincipal(principal, name) :
           indexedDB.openForPrincipal(principal, name, version);
  },

  _openWithFile: function(path, version) {
    if (DEBUG) log("_openWithFile");

    ensureIndexedDB();

    if (DEBUG) log("Opening '" + path + "'");

    return version == undefined ?
           indexedDB.openFile(path) :
           indexedDB.openFile(path, version);
  },

  _supportsOpenWithFile: function() {
    this._ensureIndexedDB();

    return "openFile" in indexedDB;
  },

  _prettyPrintReplacer: function(key, value) {
    let type = typeof(value);
    if (type == "object" && value !== null) {
      if (value.constructor.name == "Date") {
        return "<Date: '" + value.toLocaleString() + "'>";
      }
      if (value instanceof Ci.nsIDOMFile) {
        return "<Blob: name = \"" + value.name + "\", size = " + value.size +
               ", type = \"" + value.type + "\", lastModifiedDate = " +
               value.lastModifiedDate.toLocaleString() + ">";
      }
      if (value instanceof Ci.nsIDOMBlob) {
        return "<Blob: size = " + value.size + ", type = \"" + value.type +
               "\">";
      }
    } else if (type == "string") {
      let length = value.length;
      if (length > 100) {
        return value.substring(0, 100) + "<..." + length + ">";
      }
    }
    return value;
  },

  _keyToDisplayText: function(key) {
    let type = typeof(key);
    if (type == "string") {
      return "\"" + key + "\"";
    }
    if (type == "number") {
      return key.toString();
    }
    let tmp = this._prettyPrintReplacer(undefined, key);
    if (typeof(tmp) == "string") {
      return tmp;
    }
    if (type == "object") {
      if (key.constructor.name == "Array") {
        return JSON.stringify(key, this._prettyPrintReplacer);
      }
    }
    return undefined;
  },

  _valueToDisplayText: function(value) {
    let valueAsKey = this._keyToDisplayText(value);
    if (valueAsKey !== undefined) {
      return valueAsKey;
    }
    if (value === undefined || value === null || value === true ||
        value === false) {
      return value + "";
    }
    return JSON.stringify(value, this._prettyPrintReplacer);
  },

  _rebuildProfileFilesTree: function() {
    if (DEBUG) log("_rebuildProfileFilesTree");

    let profileElement = document.getElementById("treechildren-profile");
    let profileItems = profileElement.children;

    let itemsToRemove = [];

    for (let i = 0; i < profileItems.length; i++) {
      let profileItem = profileItems[i];
      if (profileItem.id != "treeitem-status") {
        itemsToRemove.push(profileItem);
      }
    }

    for (let i in itemsToRemove) {
      profileElement.removeChild(itemsToRemove[i]);
    }

    let statusCell = document.getElementById("treecell-status");
    let label = this._stringBundle.getString("nav-tree.searching");
    statusCell.setAttribute("label", label);

    document.getElementById("treeitem-status").removeAttribute("hidden");

    this._getProfileFiles().then(function(results) {
      this._buildProfileFilesTree(results);
    }.bind(this), deferThrow);
  },

  _insertImportedDatabaseTreeItem: function(name) {
    if (DEBUG) log("_insertImportedDatabaseTreeItem");
    const chromeOrigin = "chrome";

    let profileTreeChildren = document.getElementById("treechildren-profile");
    let profileItems = profileTreeChildren.children;

    let targetTreeChildren = profileTreeChildren;

    for (let i = 0; i < profileItems.length; i++) {
      let profileItem = profileItems[i];
      if (profileItem.hasAttribute("data-idb-key")) {
        let idbKey = JSON.parse(profileItem.getAttribute("data-idb-key"));
        if (idbKey[0] == chromeOrigin) {
          profileItem.setAttribute("open", "true");
          targetTreeChildren = profileItem.firstChild.nextElementSibling;
          break;
        }
      }
    }

    if (targetTreeChildren == profileTreeChildren) {
      // Didn't find chrome origin, make a new one.
      let item = document.createElement("treeitem");
      item.setAttribute("data-idb-key", JSON.stringify([ chromeOrigin ]));
      item.setAttribute("container", "true");
      item.setAttribute("open", "true");

      targetTreeChildren.insertBefore(item, targetTreeChildren.firstChild);

      let row = document.createElement("treerow");
      item.appendChild(row);

      let cell = document.createElement("treecell");
      cell.setAttribute("label", chromeOrigin);
      cell.setAttribute("properties", "origin");
      row.appendChild(cell);

      targetTreeChildren = document.createElement("treechildren");
      item.appendChild(targetTreeChildren);
    }

    // Find the previous item for this database (if it exists) and the insertion
    // spot for the new item.
    let nextItem;
    let oldItem;

    let chromeItems = targetTreeChildren.children;
    for (let i = 0; i < chromeItems.length; i++) {
      let chromeItem = chromeItems[i];
      let itemName = JSON.parse(chromeItem.getAttribute("data-idb-key"))[1];
      if (itemName == name) {
        oldItem = chromeItem;
      } else if (!nextItem && itemName > name) {
        nextItem = chromeItem;
        break;
      }
    }

    if (oldItem) {
      targetTreeChildren.removeChild(oldItem);

      if ((chromeOrigin in this._loadedDatabases) &&
          (name in this._loadedDatabases[chromeOrigin])) {
        delete this._loadedDatabases[chromeOrigin][name];
      }
    }

    let idbKey = [ chromeOrigin, name ];

    let item = document.createElement("treeitem");
    item.setAttribute("data-idb-key", JSON.stringify(idbKey));
    targetTreeChildren.appendChild(item);

    let row = document.createElement("treerow");
    item.appendChild(row);

    let cell = document.createElement("treecell");
    cell.setAttribute("label", name);
    cell.setAttribute("properties", "database unloaded");
    row.appendChild(cell);

    let tree = document.getElementById("tree-nav");
    let rowIndex = tree.view.getIndexOfItem(item);

    tree.treeBoxObject.ensureRowIsVisible(rowIndex);
    tree.view.selection.select(rowIndex);
    tree.focus();
  },

  _cellFromMouseEvent: function(event, treeArg) {
    let tree = treeArg || document.getElementById("tree-nav");

    let row = { }, col = { }, child = { };
    tree.treeBoxObject.getCellAt(event.clientX, event.clientY, row, col, child);

    if (row.value < 0) {
      return null;
    }

    let column = col.value;
    if (!column) {
      return null;
    }

    let item = tree.view.getItemAtIndex(row.value, column);

    let cell = item.firstChild.firstChild;
    for (let i = 1; cell && i <= column.index; i++) {
      cell = cell.nextElementSibling;
    }

    return cell;
  },

  _beginLoad: function(cell, properties) {
    if (DEBUG) log("_beginLoad");

    if (!properties) {
      properties = cell.getAttribute("properties");
    }

    let nowLoading;
    if (this._loadingCell && this._loadingCell != cell) {
      this._endLoad(true);
      nowLoading = true;
    } else {
      nowLoading = properties.indexOf("loading") == -1;
    }

    if (!nowLoading) {
      removeProperty(cell, "loading");
      this._endLoad(true);
      this._loadingCell = null;
      return;
    }

    let item = cell.parentElement.parentElement;

    let [ key, isIDBKey ] = this._getKeyFromElement(item);
    if (!key) {
      return;
    }

    if (key.length < 3) {
      if (DEBUG) log("Bad key: " + JSON.stringify(key));
      return;
    }

    addProperty(cell, "loading");
    this._loadingCell = cell;

    this._populateDataTree(key, isIDBKey);

    if (this._lastLoadedTreeCell) {
      removeProperty(this._lastLoadedTreeCell, "displayed");
    }

    let treecell = cell.previousElementSibling;
    addProperty(treecell, "displayed");

    this._lastLoadedTreeCell = treecell;
  },

  _endLoad: function(canceled) {
    if (DEBUG) log("_endLoad");

    this._currentDataRequestSerial++;

    if (this._loadingCell) {
      removeProperty(this._loadingCell, "loading");
      this._loadingCell = null;
    }

    if (canceled) {
      this._dataTreeView.cancel();
    }
  },

  _sanitizeProfile: function() {
    let directory = OS.Path.join(OS.Constants.Path.profileDir, "indexedDB");
    if (DEBUG) log("Sanitizing profile folder: " + directory);

    function recursiveSearchDelete(srcDir) {
      return Task.spawn(function() {
        let srcInfo;
        try {
          srcInfo = yield OS.File.stat(srcDir);
        } catch (e if e instanceof OS.File.Error && e.becauseNoSuchFile) {
          // Nothing to do if the source directory doesn't exist.
          return;
        }

        let iterator = new OS.File.DirectoryIterator(srcDir);
        try {
          yield iterator.forEach(entry => {
            if (entry.isDir) {
              return recursiveSearchDelete(entry.path);
            }
            if (entry.name == ".DS_Store") {
              return OS.File.remove(entry.path);
            }
          });
        }
        finally {
          iterator.close();
        }
      });
    }

    return recursiveSearchDelete(directory);
  }
};
