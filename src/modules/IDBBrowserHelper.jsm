/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { classes: Cc, interfaces: Ci, utils: Cu, manager: Cm } = Components;

const EXPORTED_SYMBOLS = ["IDBBrowserHelper"];

const NS_XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

// Files included in this package.
const URL_IDBBROWSER = "chrome://idbbrowser/content/browser.xul";
const URL_STRINGBUNDLE = "chrome://idbbrowser/locale/bootstrap.properties";

// Elements that are needed to find insertion points.
const ID_BROADCASTERSET_MAIN = "mainBroadcasterSet";
const ID_COMMANDSET_MAIN = "mainCommandSet";
const ID_KEYSET_MAIN = "mainKeyset";
const ID_MENUSEPARATOR_DEVTOOLS = "devToolsEndSeparator";
const ID_MENUSEPARATOR_DEVTOOLS_APP = "appmenu_devToolsEndSeparator";
const ID_TOOLBARBUTTON_DEVTOOLS = "developer-toolbar-other-tools";

// Elements that get inserted into the DOM.
const ID_BROADCASTER_IDBBROWSER = "devtoolsMenuBroadcaster_IDBBrowser";
const ID_COMMAND_IDBBROWSER = "Tools:IDBBrowser";
const ID_KEYSET_IDBBROWSER = "idbbrowserKeyset";
const ID_KEY_IDBBROWSER = "key_idbbrowser";
const ID_MENUITEM_IDBBROWSER = "menu_idbbrowser";
const ID_MENUITEM_IDBBROWSER_APP = "menu_idbbrowser_app";
const ID_MENUITEM_IDBBROWSER_TOOLBAR = "menu_idbbrowser_toolbar";

const WINDOW_TYPE_BROWSER = "navigator:browser";
const WINDOW_TYPE_IDBBROWSER = "IDBBrowser:Browser";

const DEBUG = false;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "Services", 
  "resource://gre/modules/Services.jsm");

function log(msg) {
  msg = "IDBBrowser:IDBBrowserHelper.jsm: " + msg;
  Services.console.logStringMessage(msg);
  dump(msg + "\n");
}

function openNewBrowser() {
  if (DEBUG) log("openNewBrowser");

  return Services.ww.openWindow(null, URL_IDBBROWSER, null, "chrome,resizable",
                                null);
}

function raiseOrOpenNewBrowser() {
  if (DEBUG) log("raiseOrOpenNewBrowser");

  let idbBrowser = Services.wm.getMostRecentWindow(WINDOW_TYPE_IDBBROWSER);
  if (!idbBrowser) {
    idbBrowser = openNewBrowser();
  }

  idbBrowser.focus();

  return idbBrowser;
}

const WindowListener = {
  _loadIntoWindow: function(domWindow) {
    if (DEBUG) log("loading into window");

    // Grab the strings we need.
    let strings = Services.strings.createBundle(URL_STRINGBUNDLE);

    let label = strings.GetStringFromName("menuLabel");
    let accessKey = strings.GetStringFromName("menuAccessKey");
    let shortcutKey = strings.GetStringFromName("menuShortcutKey");
    let modifiers = strings.GetStringFromName("menuModifiers");

    let doc = domWindow.document;

    // Create a <broadcaster> for miscellaneous state (e.g. label, disabled).
    let broadcaster = doc.createElementNS(NS_XUL, "broadcaster");
    broadcaster.setAttribute("id", ID_BROADCASTER_IDBBROWSER);
    broadcaster.setAttribute("label", label);

    doc.getElementById(ID_BROADCASTERSET_MAIN).appendChild(broadcaster);

    // Create a <command> to let us know when to bring up our window.
    let command = doc.createElementNS(NS_XUL, "command");
    command.setAttribute("id", ID_COMMAND_IDBBROWSER);
    command.setAttribute("observes", ID_BROADCASTER_IDBBROWSER);
    command.addEventListener("command", raiseOrOpenNewBrowser);

    // nsXBLWindowKeyHandler requires an 'oncommand' attribute to exist before
    // it will allow the handler to run... Grr.
    command.setAttribute("oncommand", ";");

    doc.getElementById(ID_COMMANDSET_MAIN).appendChild(command);

    // Adding a <key> to an existing <keyset> does not work. Instead we have to
    // create a new <keyset> and insert that as well.
    let keyset = doc.createElementNS(NS_XUL, "keyset");
    keyset.setAttribute("id", ID_KEYSET_IDBBROWSER);

    let key = doc.createElementNS(NS_XUL, "key");
    key.setAttribute("id", ID_KEY_IDBBROWSER);
    key.setAttribute("key", shortcutKey);
    key.setAttribute("modifiers", modifiers);
    key.setAttribute("command", ID_COMMAND_IDBBROWSER);

    keyset.appendChild(key);
    doc.getElementById(ID_KEYSET_MAIN).parentNode.appendChild(keyset);

    // Now add the actual menu items. Currently there are three distinct menus
    // that contain all the web developer tools, so we have to modify them all.
    function createMenuItem(id) {
      let menuitem = doc.createElementNS(NS_XUL, "menuitem");
      menuitem.setAttribute("id", id);
      menuitem.setAttribute("key", ID_KEY_IDBBROWSER);
      menuitem.setAttribute("observes", ID_BROADCASTER_IDBBROWSER);
      menuitem.setAttribute("command", ID_COMMAND_IDBBROWSER);
      return menuitem;
    }

    // This is the Tools -> Web Developer menu.
    let menusep = doc.getElementById(ID_MENUSEPARATOR_DEVTOOLS);
    let menuitem = createMenuItem(ID_MENUITEM_IDBBROWSER);
    // This is the only menu that gets an 'accesskey' property.
    menuitem.setAttribute("accesskey", accessKey);
    menusep.parentNode.insertBefore(menuitem, menusep);

    // This is the App button's Web Developer menu.
    menusep = doc.getElementById(ID_MENUSEPARATOR_DEVTOOLS_APP);
    if (menusep) {
      menuitem = createMenuItem(ID_MENUITEM_IDBBROWSER_APP);
      menusep.parentNode.insertBefore(menuitem, menusep);
    }

    // This is the More Tools popup menu on the Web Developer toolbar.
    let toolbar = doc.getElementById(ID_TOOLBARBUTTON_DEVTOOLS);
    if (toolbar) {
      let node = toolbar.firstChild;
      if (node.nodeName == "menupopup") {
        node = node.firstChild;
        while (node && node.nodeName != "menuseparator") {
          node = node.nextSibling;
        }
        if (node) {
          menuitem = createMenuItem(ID_MENUITEM_IDBBROWSER_TOOLBAR);
          node.parentNode.insertBefore(menuitem, node);
        }
      }
    }
  },

  _unloadFromWindow: function(domWindow) {
    if (DEBUG) log("unloading from window");

    // Remove everything we added above.
    let ids = [
      ID_MENUITEM_IDBBROWSER_TOOLBAR,
      ID_MENUITEM_IDBBROWSER_APP,
      ID_MENUITEM_IDBBROWSER,
      ID_KEY_IDBBROWSER,
      ID_KEYSET_IDBBROWSER,
      ID_COMMAND_IDBBROWSER,
      ID_BROADCASTER_IDBBROWSER
    ];

    let doc = domWindow.document;

    for each (let id in ids) {
      let node = doc.getElementById(id);
      if (node) {
        node.parentNode.removeChild(node);
      }
    }
  },

  onOpenWindow: function(window) {
    let domWindow = window.QueryInterface(Ci.nsIInterfaceRequestor)
                          .getInterface(Ci.nsIDOMWindow);

    let loadIntoWindow = this._loadIntoWindow.bind(this);
    let listener = function() {
      domWindow.removeEventListener("load", listener, false);

      // This function gets called for all windows so only muck with the window
      // if it's the right type.
      let windowType =
        domWindow.document.documentElement.getAttribute("windowtype");
      if (windowType != WINDOW_TYPE_BROWSER) {
        return;
      }

      loadIntoWindow(domWindow);
    };

    domWindow.addEventListener("load", listener, false);
  },

  onCloseWindow: function(window) {
    let domWindow = window.QueryInterface(Ci.nsIInterfaceRequestor)
                          .getInterface(Ci.nsIDOMWindow);
    let windowType =
      domWindow.document.documentElement.getAttribute("windowtype");
    if (windowType != WINDOW_TYPE_BROWSER) {
      return;
    }

    this._unloadFromWindow(domWindow);
  },

  onWindowTitleChange: function(window, title) {
    // Nothing needs to be done here.
  }
};

const IDBBrowserHelper = {
  _unregisterComponentFunctions: [],

  startup: function() {
    // Enumerate all currently open browser windows and add menu items.
    let windows = Services.wm.getEnumerator(WINDOW_TYPE_BROWSER);
    while (windows.hasMoreElements()) {
      let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
      WindowListener._loadIntoWindow(domWindow);
    }

    // Register for notification of future window loads.
    Services.wm.addListener(WindowListener);

    // Register components.
    let registrar = Cm.QueryInterface(Ci.nsIComponentRegistrar);

    const componentsToRegister = [];

    for each (let component in componentsToRegister) {
      let { classID: classID,
            description: description,
            contractID: contractID } = component.prototype;
      let factory = XPCOMUtils._getFactory(component);

      registrar.registerFactory(classID, description, contractID, factory);

      this._unregisterComponentFunctions.push(function() {
        registrar.unregisterFactory(classID, factory);
      });
    }
  },

  shutdown: function() {
    // No longer need to know about new windows.
    Services.wm.removeListener(WindowListener);

    // Remove menu items from all existing windows.
    let windows = Services.wm.getEnumerator(WINDOW_TYPE_BROWSER);
    while (windows.hasMoreElements()) {
      let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
      WindowListener._unloadFromWindow(domWindow);
    }

    // Close all the browser windows that are currently open.
    windows = Services.wm.getEnumerator(WINDOW_TYPE_IDBBROWSER);
    while (windows.hasMoreElements()) {
      let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
      domWindow.close();
    }

    // Unregister components
    for each (let unregister in this._unregisterComponentFunctions) {
      unregister();
    }
    this._unregisterComponentFunctions = [];
  },

  openNewBrowser: function() {
    openNewBrowser();
  }
};
