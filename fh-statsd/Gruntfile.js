module.exports = function(grunt) {
  'use strict';

  // Just set shell commands for running different types of tests
  grunt.initConfig({
    _test_runner: 'expresso',
    _unit_args: '-I lib -q -c -b',

    // These are the properties that grunt-fh-build will use
    unit: '<%= _test_runner %> <%= _unit_args %>',
    unit_cover: 'istanbul cover --dir cov-unit <%= _test_runner %> -- <%= _unit_args %>'
  });

  grunt.loadNpmTasks('grunt-fh-build');
  grunt.registerTask('default', ['fh:default']);
};
