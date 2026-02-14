"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSessions = parseSessions;
exports.parseWindows = parseWindows;
exports.parsePanes = parsePanes;
exports.assembleServer = assembleServer;
var FIELD_SEP = "\t";
function parseSessions(output) {
    if (!output.trim())
        return [];
    return output.trim().split("\n").map(parseSessionLine);
}
// Format: $id\tname\tattached
function parseSessionLine(line) {
    var _a = line.split(FIELD_SEP), id = _a[0], name = _a[1], attached = _a[2];
    return {
        id: id,
        name: name,
        attached: attached === "1",
        windows: [],
    };
}
function parseWindows(output) {
    if (!output.trim())
        return [];
    return output.trim().split("\n").map(parseWindowLine);
}
// Format: sessionId\t@id\tindex\tname\tactive
function parseWindowLine(line) {
    var _a = line.split(FIELD_SEP), sessionId = _a[0], id = _a[1], index = _a[2], name = _a[3], active = _a[4];
    return {
        sessionId: sessionId,
        id: id,
        index: Number(index),
        name: name,
        active: active === "1",
        panes: [],
    };
}
function parsePanes(output) {
    if (!output.trim())
        return [];
    return output.trim().split("\n").map(parsePaneLine);
}
// Format: windowId\t%id\tindex\tactive\tcommand\tpid\tworkingDir\twidth\theight
function parsePaneLine(line) {
    var _a = line.split(FIELD_SEP), windowId = _a[0], id = _a[1], index = _a[2], active = _a[3], command = _a[4], pid = _a[5], workingDir = _a[6], width = _a[7], height = _a[8];
    return {
        windowId: windowId,
        id: id,
        index: Number(index),
        active: active === "1",
        command: command,
        pid: Number(pid),
        workingDir: workingDir,
        width: Number(width),
        height: Number(height),
    };
}
function assembleServer(socketPath, sessions, windows, panes) {
    var _a, _b, _c, _d;
    var panesByWindow = new Map();
    for (var _i = 0, panes_1 = panes; _i < panes_1.length; _i++) {
        var _e = panes_1[_i];
        var windowId = _e.windowId, pane = __rest(_e, ["windowId"]);
        var list = (_a = panesByWindow.get(windowId)) !== null && _a !== void 0 ? _a : [];
        list.push(pane);
        panesByWindow.set(windowId, list);
    }
    var windowsBySession = new Map();
    for (var _f = 0, windows_1 = windows; _f < windows_1.length; _f++) {
        var _g = windows_1[_f];
        var sessionId = _g.sessionId, window_1 = __rest(_g, ["sessionId"]);
        var win = __assign(__assign({}, window_1), { panes: (_b = panesByWindow.get(window_1.id)) !== null && _b !== void 0 ? _b : [] });
        var list = (_c = windowsBySession.get(sessionId)) !== null && _c !== void 0 ? _c : [];
        list.push(win);
        windowsBySession.set(sessionId, list);
    }
    for (var _h = 0, sessions_1 = sessions; _h < sessions_1.length; _h++) {
        var session = sessions_1[_h];
        session.windows = (_d = windowsBySession.get(session.id)) !== null && _d !== void 0 ? _d : [];
    }
    return { socketPath: socketPath, sessions: sessions };
}
