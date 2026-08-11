"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JclLineType = void 0;
var JclLineType;
(function (JclLineType) {
    JclLineType[JclLineType["Comment"] = 0] = "Comment";
    JclLineType[JclLineType["InlineDataStart"] = 1] = "InlineDataStart";
    JclLineType[JclLineType["InlineData"] = 2] = "InlineData";
    JclLineType[JclLineType["InlineDataEnd"] = 3] = "InlineDataEnd";
    JclLineType[JclLineType["JclStatement"] = 4] = "JclStatement";
    JclLineType[JclLineType["DDStatement"] = 5] = "DDStatement";
    JclLineType[JclLineType["Blank"] = 6] = "Blank";
    JclLineType[JclLineType["Unknown"] = 7] = "Unknown";
})(JclLineType || (exports.JclLineType = JclLineType = {}));
//# sourceMappingURL=types.js.map