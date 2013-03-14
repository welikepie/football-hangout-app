/*global module:false, require:true */
module.exports = function (grunt) {
	"use strict";

	grunt.initConfig({

		'pkg': grunt.file.readJSON('package.json'),

		'recess': {

			'lint': {
				'src': 'styles/*.less',
				'options': {
					'compile': false,
					'compress': false,
					'noIDs': false,
					'noUniversalSelectors': false,
					'noOverqualifying': false
				}
			},

			'dev': {
				'options': {
					'compile': true,
					'compress': false
				},
				'src': 'styles/*.less',
				'dest': 'build/styles/styles.css'
			},

			'release': {
				'options': {
					'compile': true,
					'compress': true
				},
				'src': '<%= recess.dev.src %>',
				'dest': '<%= recess.dev.dest %>'
			}
		},

		'jshint': {
		
			'options': {
				'immed': true,		// Complains about immediate function invocations not wrapped in parentheses
				'latedef': true,	// Prohibits using a variable before it was defined
				'forin': true,		// Requires usage of .hasOwnProperty() with 'for ... in ...' loops
				'noarg': true,		// Prohibits usage of arguments.caller and arguments.callee (both are deprecated)
				'eqeqeq': true,		// Enforces the usage of triple sign comparison (=== and !==)
				'bitwise': true,	// Forbids usage of bitwise operators (rare and, most likely, & is just mistyped &&)
				'strict': true,		// Enforces usage of ES5's strict mode in all function scopes
				'undef': true,		// Raises error on usage of undefined variables
				'plusplus': true,	// Complains about ++ and -- operators, as they can cause confusion with their placement
				'unused': true,		// Complains about variables and globals that have been defined, but not used
				'curly': true,		// Requires curly braces for all loops and conditionals
				'browser': true		// Assumes browser enviroment and browser-specific globals
			},
			
			'dev': {
				'options': {
					'devel': true,
					'unused': false
				},
				'src': ['gruntfile.js', 'scripts/*.js']
			},
			'release': {
				'options': {
					'devel': false,
					'unused': true
				},
				'src': 'scripts/*.js'
			}
		
		},

		'concat': {
			'main': {
				'src': 'scripts/*.js',
				'dest': 'build/scripts/scripts.js',
				'options': { 'separator': ";\n\n" }
			},
			'vendor': {
				'src': 'scripts/vendor/**/*.js',
				'dest': 'build/scripts/vendor.js',
				'options': { 'separator': ";" }
			}
		},

		'uglify': {
			'main': {
				'src': 'scripts/*.js',
				'dest': 'build/scripts/scripts.js',
				'options': {
					'mangle': true,
					'compress': true,
					'preserveComments': false
				}
			},
			'vendor': {
				'src': 'scripts/vendor/**/*.js',
				'dest': 'build/scripts/vendor.js',
				'options': {
					'mangle': true,
					'compress': true,
					'preserveComments': false
				}
			}
		},

		'clean': {
			'build': { 'src': ['build'] },
			'release': { 'src': ['build/index.htm', 'build/styles'] }
		},

		'copy': (function () {

			var deep_copy = function (location, pattern, filter) {
				pattern = pattern || '**/*';
				filter = filter || 'isFile';
				return {
					'src': pattern,
					'dest': 'build/' + location,
					'cwd': location,
					'expand': true,
					'filter': filter
				};
			};

			return {
				'access': { 'src': '.htaccess', 'dest': 'build/.htaccess' },
				'data': deep_copy('data/'),
				'scripts': deep_copy('scripts/other/'),
				'images': deep_copy('images/'),
				'branding': deep_copy('branding/'),
				'styling': deep_copy('styles/', '**/*.!(less)'),

				'html-dev': { 'src': 'index.htm', 'dest': 'build/index.htm' },
				'html-release': {
					'src': 'index.htm',
					'dest': 'build/index.htm',
					'options': {
						'processContent': function (content) {
							return grunt.template.process(content
								.replace(
									/<link(?:[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*|[^>]*href="([^"]+)"[^>]*rel="stylesheet"[^>]*)>/gi,
									function (match, file) {
										var baseUrl = grunt.config.get('pkg.app.baseUrl'),
											css = grunt.file.read('build/' + file).replace(
												/\.\.\/images/gi,
												baseUrl + 'images'
											).replace(/\s+/gi, ' ');
										return '<style type="text/css">' + css + '</style>';
									}
								)
								.replace(
									/<!--<base[^>]*>-->/i,
									"<base href=\"<%= pkg.app.baseUrl %>\">"
								));
						}
					}
				},
				'xml': {
					'src': 'app.xml',
					'dest': 'build/app.xml',
					'options': { 'processContent': grunt.template.process }
				},
				'redirect': {
					'src': 'redirect.php',
					'dest': 'build/redirect.php',
					'options': { 'processContent': grunt.template.process }
				}
			};

		}()),

		'watch': {
			'less': {
				'files': 'styles/**/*.less',
				'tasks': ['recess:lint', 'recess:dev']
			},
			'js-main': {
				'files': 'scripts/*.js',
				'tasks': ['jshint:dev', 'concat:main']
			},
			'js-vendor': {
				'files': 'scripts/vendor/**/*.js',
				'tasks': ['concat:vendor']
			},
			'html': {
				'files': 'index.htm',
				'tasks': ['copy:html']
			}
		}

	});

	grunt.loadNpmTasks('grunt-contrib-clean');
	grunt.loadNpmTasks('grunt-contrib-copy');
	grunt.loadNpmTasks('grunt-contrib-jshint');
	grunt.loadNpmTasks('grunt-contrib-concat');
	grunt.loadNpmTasks('grunt-contrib-uglify');
	grunt.loadNpmTasks('grunt-contrib-watch');
	grunt.loadNpmTasks('grunt-recess');

	grunt.registerTask('copy-misc', ['copy:access', 'copy:data', 'copy:scripts', 'copy:images', 'copy:styling', 'copy:branding', 'copy:redirect']);

	grunt.registerTask('dev', ['clean:build', 'recess:lint', 'recess:dev', 'jshint:dev', 'concat', 'copy-misc', 'copy:html-dev', 'watch']);
	grunt.registerTask('dev-server', ['clean:build', 'recess:lint', 'recess:release', 'jshint:dev', 'concat', 'copy-misc', 'copy:html-release', 'copy:xml', 'clean:release']);
	grunt.registerTask('release', ['clean:build', 'recess:lint', 'recess:release', 'jshint:release', 'uglify', 'copy-misc', 'copy:html-release', 'copy:xml', 'clean:release']);

};