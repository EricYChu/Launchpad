/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 **/

'use strict';

Cu.import('resource://gre/modules/Services.jsm');
Cu.import('resource://gre/modules/XPCOMUtils.jsm');

let {ComponentRegistrar} = require('ComponentRegistrar');
let {WindowObserver} = require('WindowObserver');
let {FileUtils} = require('FileUtils');
let {Prefs, PrefListener} = require('Prefs');
let {Utils} = require('Utils');
let {Storage} = require('Storage');
let {BookmarkUtils} = require('BookmarkUtils');
let {KeysMap : {KEYCODES, MODIFIERS}} = require('KeysMap');
let {Localization} = require('Localization');
let locale = Localization.getBundle('locale');
let {id : ADDON_ID, STARTUP_REASON, OPTIONS_WIN_URI, OPTIONS_WIN_TYPE, MAIN_WIN_URI, CONTENT_DIR_URI, SKIN_DIR_URI, PACKAGE_NAME} = addonData;
let styleSheetService = Cc['@mozilla.org/content/style-sheet-service;1'].getService(Ci.nsIStyleSheetService);
let styleSheetURI = Services.io.newURI(SKIN_DIR_URI + 'browser.css', null, null)
let alertsService = Cc['@mozilla.org/alerts-service;1'].getService(Ci.nsIAlertsService);
let alertIcon = SKIN_DIR_URI + 'icons/logo.png';

function aboutClass() {}
aboutClass.prototype =
{
	getURIFlags : function(aURI)
	{
		return Ci.nsIAboutModule.ALLOW_SCRIPT;
	},
	newChannel : function(aURI)
	{
		let channel = Services.io.newChannel(CONTENT_DIR_URI + 'launchpad.xul', null, null);
		channel.originalURI = aURI;
		return channel;
	},
	classDescription : 'Launchpad Page',
	classID          : Components.ID('C6CB457A-9006-46A2-8415-E87DB4212F48'),
	contractID       : '@mozilla.org/network/protocol/about;1?what=launchpad',
	QueryInterface   : XPCOMUtils.generateQI([Ci.nsIAboutModule])
}
ComponentRegistrar.registerFactory(ComponentRegistrar.creatFactory(aboutClass));

Storage.openConnection(FileUtils.getDataFile(['database.sqlite'], true),
{
	onSuccess : function(aConnection)
	{
		function initTable(aName, aSchema)
		{
			aConnection.tableExists(aName,
			{
				onResult : function(aExists)
				{
					if ( ! aExists)
					{
						aConnection.createTable(aName, aSchema,
						{
							onError : function(aError)
							{
								Cu.reportError(aError);
							}
						});
					}
				},
				onError : function(aError)
				{
					Cu.reportError(aError);
				}
			});
		}
		initTable('bookmarkSnapshots', 'leafName VARCHAR(32) PRIMARY KEY, mimeType VARCHAR(32), URI TEXT, title TEXT, lastModified INTEGER, expires INTEGER, reload INTEGER, CONSTRAINT leafName UNIQUE (leafName) ON CONFLICT REPLACE');
		initTable('logs', 'id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT, created INTEGER');
	},
	onError : function(aError)
	{
		Cu.reportError(aError);
	}
});

WindowObserver.addListener('navigator:browser', 'ready', function(aWindow)
{
	let styleSheet, launchpadWindow, tabViewListener, contextMenu, keyset;
	let gBrowser = aWindow.getBrowser(), {document} = aWindow, mainWindow = document.getElementById('main-window');

	// register style sheet
	styleSheet =
	{
		_isRegistered : function()
		{
			return styleSheetService.sheetRegistered(styleSheetURI, styleSheetService.USER_SHEET);
		},
		init : function()
		{
			if ( ! this._isRegistered())
			{
				styleSheetService.loadAndRegisterSheet(styleSheetURI, styleSheetService.USER_SHEET);
			}

			return this;
		},
		uninit : function()
		{
			if (this._isRegistered())
			{
				styleSheetService.unregisterSheet(styleSheetURI, styleSheetService.USER_SHEET);
			}
		}
	}.init();

	// create launchpad window
	launchpadWindow =
	{
		window : null,
		browser : null,
		resize : null,
		_show : function()
		{
			let background = this.browser.contentDocument.getElementById('background');
			if (gBrowser.selectedBrowser.contentDocument.URL == 'about:launchpad')
			{
				background.style.opacity = 1;
			}
			else
			{
				background.style.opacity = 0.9;
			}

			if (this.window.getAttribute('display') == 'hide')
			{
				this.window.setAttribute('display', 'show');
			}
			this.browser.focus();
			if (aWindow.gURLBar.value == '')
			{
				aWindow.gURLBar.focus();
				aWindow.gURLBar.select();
			}
			aWindow.setTimeout(function()
			{
				this.resize();
			}.bind(this), 0);
		},
		_hide : function()
		{
			if (this.window.getAttribute('display') == 'show')
			{
				this.window.setAttribute('display', 'hide');
			}
			this.browser.blur();
			aWindow.gURLBar.blur();
		},
		toggle : function(aState, aForce)
		{
			let windowState = false;
			let force = aForce == true;

			if (gBrowser.selectedBrowser.contentDocument.URL == 'about:launchpad' && ! tabViewListener.isTabViewVisible())
			{
				if (this.window.getAttribute('display') == 'show')
				{
					aWindow.setTimeout(function()
					{
						this.resize();
					}.bind(this), 0);
					return;
				}

				windowState = true;
			}
			else
			{
				if (typeof(aState) == 'undefined' || aState == null)
				{
					windowState = this.window.getAttribute('display') == 'show' ? false : true;
				}
				else
				{
					windowState = aState == true;
				}
			}

			if (windowState)
			{
				this._show();
			}
			else
			{
				this._hide();
			}
		},
		addItemToLaunchpad : function(aURL, aTitle)
		{
			let bookmark =
			{
				uri      : aURL,
				title    : aTitle,
				type     : BookmarkUtils.TYPE_BOOKMARK,
				index    : BookmarkUtils.DEFAULT_INDEX,
				folderID : Prefs.bookmarksFolderID
			};
			BookmarkUtils.addBookmark(bookmark, function()
			{
				try
				{
					aWindow.setTimeout(function()
					{
						alertsService.showAlertNotification(alertIcon,
							Utils.subString(bookmark.title != '' ? bookmark.title : bookmark.uri, 48),
							locale.pageOrLinkAddedNotification,
							false, '', null, 'Firefox Extenstion Notification: Launchpad'
						);
					}, 100);
				} catch (e) {}
			});
		},
		init : function()
		{
			let mainWindowContent = document.getElementById('content');

			this.window = document.createElement('box');
			this.window.setAttribute('id', PACKAGE_NAME + '-window');
			this.window.setAttribute('display', 'hide');

			this.browser = document.createElement('browser');
			this.browser.setAttribute('id', PACKAGE_NAME + '-browser');
			this.browser.setAttribute('type', 'content');
			this.browser.setAttribute('disablehistory', true);
			this.browser.setAttribute('transparent', 'transparent');
			this.browser.setAttribute('src', MAIN_WIN_URI);

			this.window.appendChild(this.browser);
			mainWindow.appendChild(this.window);

			let hiddenWindow = document.createElement('box');
			hiddenWindow.setAttribute('id', PACKAGE_NAME + '-hidden-window');
			mainWindow.appendChild(hiddenWindow);

			this.resize = function()
			{
				let {x, y, width, height} = mainWindowContent.boxObject;

				this.browser.style.width   = width + 'px';
				this.browser.style.height  = height + 'px';
				this.window.style.width    = width + 'px';
				this.window.style.height   = height + 'px';
				this.window.style.top      = y + 'px';
				this.window.style.left     = x + 'px';
			}.bind(this);

			this.resize();
			aWindow.addEventListener('resize', this.resize, false);
			aWindow.ToggleLaunchpadWindow = this.toggle.bind(this);
			aWindow.AddPageToLaunchpad = function()
			{
				try
				{
					let window = gBrowser.selectedBrowser.contentWindow;
					this.addItemToLaunchpad(window.location.href, window.document.title);
				} catch (e) {}
			}.bind(this);

			aWindow.AddLinkToLaunchpad = function()
			{
				let {gContextMenu} = aWindow;
				let linkText;
				if (gContextMenu.onPlainTextLink)
				{
					linkText = document.commandDispatcher.focusedWindow.getSelection().toString().trim();
				}
				else
				{
					linkText = gContextMenu.linkText();
				}
				this.addItemToLaunchpad(gContextMenu.linkURL, linkText);
			}.bind(this);

			aWindow.LaunchpadButtonEvents =
			{
				onDragenter : function(aEvent)
				{
				},
				onDragover : function(aEvent)
				{
					aEvent.preventDefault();
					try
					{
						let url;
						let {dataTransfer} = aEvent;
						let types = Utils.filterDataTransferDataTypes(dataTransfer.types);
						if (types.length)
						{
							let type = types.shift();
							switch (type)
							{
								case 'text/x-moz-url':
									url = dataTransfer.getData('text/x-moz-url').split(/\n/g)[0];
									break;

								case 'text/x-moz-text-internal':
									url = dataTransfer.mozGetDataAt('text/x-moz-text-internal', 0);
									break;
							}

							if (url && url != 'about:launchpad' && url != 'about:blank')
							{
								dataTransfer.dropEffect = 'copy';
							}
						}
					}
					catch (e) {}
				},
				onDrop : function(aEvent)
				{
					let dataTransfer = aEvent.dataTransfer;
					aWindow.setTimeout(function()
					{
						try
						{
							Utils.dropEventHandler({dataTransfer : dataTransfer}, function(aURI, aTitle) launchpadWindow.addItemToLaunchpad(aURI, aTitle));
						}
						catch (e) {}
					}, 0);
				}
			};

			return this;
		},
		uninit : function()
		{
			aWindow.removeEventListener('resize', this.resize, false);
			delete aWindow.ToggleLaunchpadWindow;
			delete aWindow.AddPageToLaunchpad;
			delete aWindow.AddLinkToLaunchpad;
			delete aWindow.LaunchpadButtonEvents;
			this.window.parentNode.removeChild(this.window);
			this.resize = null;
		}
	}.init();

	tabViewListener =
	{
		gTabViewDeck : null,
		isTabViewVisible : function()
		{
			let gTabViewFrame = document.getElementById('tab-view');
			return gTabViewFrame && gTabViewFrame == this.gTabViewDeck.selectedPanel;
		},
		shownListener : function()
		{
			aWindow.ToggleLaunchpadWindow(false, true);
		},
		hiddenListener : function()
		{
			gBrowser.selectedBrowser.contentDocument.URL == 'about:launchpad' && aWindow.ToggleLaunchpadWindow(true);
		},
		init : function()
		{
			this.gTabViewDeck = document.getElementById('tab-view-deck');
			aWindow.addEventListener('tabviewshown', this.shownListener, true);
			aWindow.addEventListener('tabviewhidden', this.hiddenListener, true);

			return this;
		},
		uninit : function()
		{
			aWindow.removeEventListener('tabviewshown', this.shownListener, true);
			aWindow.removeEventListener('tabviewhidden', this.hiddenListener, true);
			this.gTabViewDeck = null;
		}
	}.init();

	contextMenu =
	{
		listener : null,
		menuitems : null,
		contentAreaContextMenu : null,
		showItem: function(aItem, aShow)
		{
			aItem.hidden = ! aShow;
		},
		init : function()
		{
			let options =
			{
				attributes: true,
				attributeFilter: ['popupState']
			};
			this.menuitems = [];
			this.observers = [];
			this.contentAreaContextMenu = document.getElementById('contentAreaContextMenu');

			let menuitemBookmarkPage, menuitemBookmarkLink, menuitemAddPage, menuitemAddLink, gContextMenu;
			menuitemBookmarkPage = document.getElementById('context-bookmarkpage');
			menuitemBookmarkLink= document.getElementById('context-bookmarklink');

			menuitemAddPage = document.createElement('menuitem');
			menuitemAddPage.setAttribute('id', PACKAGE_NAME + '-context-add-page-to-launchpad');
			menuitemAddPage.setAttribute('oncommand', 'AddPageToLaunchpad();');
			menuitemAddPage.setAttribute('label', locale.addThisPageToLaunchpad);
			menuitemAddPage.setAttribute('hidden', true);

			menuitemAddLink = document.createElement('menuitem');
			menuitemAddLink.setAttribute('id', PACKAGE_NAME + '-context-add-link-to-launchpad');
			menuitemAddLink.setAttribute('oncommand', 'AddLinkToLaunchpad();');
			menuitemAddLink.setAttribute('label', locale.addThisLinkToLaunchpad);
			menuitemAddLink.setAttribute('hidden', true);

			this.menuitems.push(menuitemAddPage, menuitemAddLink);

			this.contentAreaContextMenu.insertBefore(menuitemAddPage, menuitemBookmarkPage);
			this.contentAreaContextMenu.insertBefore(menuitemAddLink, menuitemBookmarkLink);

			this.listener = function()
			{
				let {gContextMenu} = aWindow;
				if (gContextMenu)
				{
					this.showItem(menuitemAddPage, ! (gContextMenu.isContentSelected || gContextMenu.onTextInput || gContextMenu.onLink || gContextMenu.onImage || gContextMenu.onVideo || gContextMenu.onAudio || gContextMenu.onSocial));
					this.showItem(menuitemAddLink, (gContextMenu.onLink && ! gContextMenu.onMailtoLink && ! gContextMenu.onSocial) || gContextMenu.onPlainTextLink);
				}
			}.bind(this);

			this.contentAreaContextMenu.addEventListener('popupshowing', this.listener, false);

			return this;
		},
		uninit : function()
		{
			this.contentAreaContextMenu.removeEventListener('popupshowing', this.listener, false);
			this.listener = null;
			for (let i = 0; i < this.menuitems.length; i++)
			{
				let menuitem = this.menuitems[i];
				menuitem.parentNode.removeChild(menuitem);
			}
			this.menuitems = null;
		}
	}.init();

	// create keyset
	keyset =
	{
		keysets : null,
		_listener : null,
		init : function()
		{
			let openLaunchdShortcutKeyset, addPageToLaunchpadShortcutKeyset;
			openLaunchdShortcutKeyset = new createKeyset('openLaunchdShortcut', 'ToggleLaunchpadWindow');
			addPageToLaunchpadShortcutKeyset = new createKeyset('addPageToLaunchpadShortcut', 'AddPageToLaunchpad');
			this.keysets = [openLaunchdShortcutKeyset, addPageToLaunchpadShortcutKeyset];

			this._listener = function(aName)
			{
				switch (aName)
				{
					case 'openLaunchdShortcut':
						openLaunchdShortcutKeyset.reset();
						break;

					case 'addPageToLaunchpadShortcut':
						addPageToLaunchpadShortcutKeyset.reset();
						break;
				}
			};

			PrefListener.add(this._listener);

			function createKeyset(aPrefName, aCommand)
			{
				let prefName, keyset;
				prefName = aPrefName;
				this.remove = function()
				{
					try
					{
						keyset && keyset.parentNode.removeChild(keyset);
					} catch (e) {}
				};
				this.reset = function()
				{
					this.remove();

					let shortcut = Prefs[prefName];
					if ( ! shortcut || typeof(shortcut) != 'object') return;

					let modifiers, keycode;
					keycode = shortcut.keycode
						? parseInt(shortcut.keycode)
						: 0;

					if ( ! keycode) return;

					let keyModifiers = [];
					let keyKeycode = '';

					modifiers = shortcut.modifiers
						? (Array.isArray(shortcut.modifiers) ? shortcut.modifiers : [])
						: [];

					for (let i = 0; i < modifiers.length; i++)
					{
						let [keyName] = MODIFIERS[modifiers[i]];
						keyModifiers.push(keyName);
					}

					if (keycode && KEYCODES[keycode])
					{
						let [constantString] = KEYCODES[keycode];
						keyKeycode = constantString;
					}

					keyset = document.createElement('keyset');
					let key = document.createElement('key');
					key.setAttribute('id', PACKAGE_NAME + '-' + prefName);
					key.setAttribute('oncommand', aCommand + '();');
					key.setAttribute('modifiers', keyModifiers.join(','));
					key.setAttribute('keycode', keyKeycode);
					keyset.appendChild(key);
					mainWindow.appendChild(keyset);
				};
				this.reset();
				return this;
			}

			return this;
		},
		uninit : function()
		{
			PrefListener.remove(this._listener);
			try
			{
				for (let i = 0; i < this.keysets.length; i++)
				{
					this.keysets[i].remove();
				}
				this.keysets = null;
			} catch (e) {}
			this._listener = null;
		}
	}.init();

	if (Prefs.loadInBlankNewWindows && gBrowser.tabs.length < 2)
	{
		let {selectedBrowser, selectedTab} = gBrowser;
		let DOMWindow = selectedBrowser.docShell.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
		let webNavigation = DOMWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation);
		let uriToLoad = null;

		if ('arguments' in aWindow && aWindow.arguments[0])
		{
			uriToLoad = aWindow.arguments[0];
		}

		let isLoadingBlank = uriToLoad == 'about:blank' || uriToLoad == '' || aWindow.gIsLoadingBlank;

		if (isLoadingBlank && webNavigation.currentURI.spec == 'about:blank' && ! selectedTab.hasAttribute('busy'))
		{
			webNavigation.loadURI('about:launchpad', null, null, null, null);
			aWindow.setTimeout(function()
			{
				selectedBrowser.userTypedValue = '';
				aWindow.gURLBar.value = '';
				aWindow.gURLBar.focus();
				aWindow.gURLBar.select();
			}, 0);
			aWindow.ToggleLaunchpadWindow(true);
		}
	}

	function shutdownHandler()
	{
		keyset.uninit();
		contextMenu.uninit();
		launchpadWindow.uninit();
		styleSheet.uninit();
		tabViewListener.uninit();
		aWindow.removeEventListener('unload', onUnload);
	}

	function onUnload()
	{
		keyset.uninit();
		contextMenu.uninit();
		launchpadWindow.uninit();
		tabViewListener.uninit();
		onShutdown.remove(shutdownHandler);
	}

	onShutdown.add(shutdownHandler);

	aWindow.addEventListener('unload', onUnload, false);
});

WindowObserver.addListener('navigator:browser', 'load', function(aWindow)
{
	if (Prefs.firstrun == true)
	{
		Prefs.firstrun = false;
		aWindow.ToggleLaunchpadWindow(true);
		aWindow.openDialog(OPTIONS_WIN_URI, OPTIONS_WIN_TYPE, 'chrome,titlebar,centerscreen,dialog=yes');
	}

	let toolbarButton, pageLoadListener, progressListener;
	let gBrowser = aWindow.getBrowser(), {document} = aWindow, mainWindow = document.getElementById('main-window');

	// add button to toolbar
	toolbarButton =
	{
		button : null,
		appendButtonToToolbar : function()
		{
			let toolbars = document.querySelectorAll('toolbar');
			let toolbar, beforeNode = null, button = this.button;

			for (let i = 0; i < toolbars.length; i++)
			{
				let currentset = toolbars[i].getAttribute('currentset').split(',');
				let index = currentset.indexOf(button.id);
				if (index > -1)
				{
					toolbar = toolbars[i];
					beforeNode = index + 1 < currentset.length ?
					             (document.getElementById(currentset[index + 1]) || null) : null;
					break;
				}
			}

			if (toolbar)
			{
				toolbar.appendChild(button);
				toolbar.insertItem(button.id, beforeNode);
			}
			else
			{
				document.getElementById('navigator-toolbox').palette.appendChild(this.button);
				if (Prefs.toolbarButtonPlace)
				{
					let [toolbarID, beforeID] = Prefs.toolbarButtonPlace;
					toolbar = toolbarID ? document.getElementById(toolbarID) : null;
					if (toolbar)
					{
						let currentset = toolbar.hasAttribute('currentset') ?
						                 toolbar.getAttribute('currentset').split(',') : toolbar.getAttribute('defaultset').split(',');

						let index = beforeID ? currentset.indexOf(beforeID) : -1;
						beforeNode = index > -1 ?
						             (document.getElementById(beforeID) || null) : null;

						toolbar.appendChild(button);
						toolbar.insertItem(button.id, beforeNode);

						beforeNode ? currentset.splice(index, 0, button.id) : currentset.push(button.id);

						let newSet = currentset.join(',');
						toolbar.setAttribute('currentset', newSet);
						toolbar.currentSet = newSet;
						document.persist(toolbarID, 'currentset');

						try
						{
							aWindow.BrowserToolboxCustomizeDone(true);
						} catch (e) {}
					}
				}
			}
		},
		init : function()
		{
			let button = document.createElement('toolbarbutton');
			button.setAttribute('id', PACKAGE_NAME + '-toolbar-button');
			button.setAttribute('label', locale.toolbarButtonLabel);
			button.setAttribute('tooltiptext', locale.toolbarButtonTooltip);
			button.setAttribute('oncommand', 'ToggleLaunchpadWindow();');
			button.setAttribute('ondragenter', 'LaunchpadButtonEvents.onDragenter(event);');
			button.setAttribute('ondragover', 'LaunchpadButtonEvents.onDragover(event);');
			button.setAttribute('ondrop', 'LaunchpadButtonEvents.onDrop(event);');
			button.classList.add('toolbarbutton-1');
			button.classList.add('chromeclass-toolbar-additional');
			this.button = button;
			this.appendButtonToToolbar();

			return this;
		},
		uninit : function()
		{
			let toolbars = document.querySelectorAll('toolbar'), button = this.button;
			let toolbarButtonPlace = [null, null];

			for (let i = 0; i < toolbars.length; i++)
			{
				let currentset = toolbars[i].getAttribute('currentset').split(',');
				let index = currentset.indexOf(button.id);
				if (index >= 0)
				{
					toolbarButtonPlace = [toolbars[i].id, currentset[index + 1]];
					break;
				}
			}

			Prefs.toolbarButtonPlace = toolbarButtonPlace;
			button.parentNode.removeChild(button);
			this.button = null;
		}
	}.init();

	pageLoadListener =
	{
		appcontent : null,
		onPageLoad : function(aEvent)
		{
			if (aEvent.originalTarget.URL == 'about:launchpad')
			{
				let tab = gBrowser.tabContainer.childNodes[gBrowser.getBrowserIndexForDocument(aEvent.originalTarget)];
				tab.linkedBrowser.userTypedValue = '';

				if (tab == gBrowser.selectedTab)
				{
					aWindow.setTimeout(function()
					{
						aWindow.gURLBar.value = '';
						aWindow.gURLBar.focus();
						aWindow.gURLBar.select();
					}, 0);
					aWindow.ToggleLaunchpadWindow(true);
				}
			}
		},
		init : function()
		{
			this.appcontent = document.getElementById('appcontent');
			this.appcontent && this.appcontent.addEventListener('load', this.onPageLoad, true);

			return this;
		},
		uninit : function()
		{
			this.appcontent && this.appcontent.removeEventListener('load', this.onPageLoad, true);
			this.appcontent = null;
		}
	}.init();

	// progress listener
	progressListener =
	{
		QueryInterface : XPCOMUtils.generateQI(['nsIWebProgressListener', 'nsISupportsWeakReference']),
		loadingURI : null,
		onLocationChange : function(aProgress, aRequest, aURI)
		{
			if (aURI.spec != 'about:launchpad')
			{
				aWindow.ToggleLaunchpadWindow(false);
			}
			else
			{
				if ( ! gBrowser.selectedBrowser.userTypedValue)
				{
					aWindow.setTimeout(function()
					{
						aWindow.gURLBar.value = '';
						aWindow.gURLBar.focus();
						aWindow.gURLBar.select();
					}, 0);
				}
				aWindow.ToggleLaunchpadWindow(true);
			}
		},
		init : function()
		{
			gBrowser.addProgressListener(this);
			return this;
		},
		uninit : function()
		{
			gBrowser.removeProgressListener(this);
		}
	}.init();

	function shutdownHandler()
	{
		progressListener.uninit();
		pageLoadListener.uninit();
		toolbarButton.uninit();
		aWindow.removeEventListener('unload', onUnload);
	}

	function onUnload()
	{
		progressListener.uninit();
		pageLoadListener.uninit();
		toolbarButton.uninit();
		onShutdown.remove(shutdownHandler);
	}

	onShutdown.add(shutdownHandler);

	aWindow.addEventListener('unload', onUnload, false);
});

