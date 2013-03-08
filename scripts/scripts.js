/*global $:true, _:true, gapi:true, _gaq:true */
window.init = function () {
	"use strict";

	_.templateSettings = {
		'interpolate' : /(?:&lt;|%3C|<)(?:%21|!)--(?:%21|!)(.+?)(?:%21|!)--(?:>|%3E|&gt;)/g,
		'evaluate' : /(?:&lt;|%3C|<)(?:%21|!)--%(.+?)%--(?:>|%3E|&gt;)/g
	};

	

};