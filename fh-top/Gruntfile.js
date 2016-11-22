module.exports = function(grunt) {
  'use strict';

  // Just set shell commands for running different types of tests
  grunt.initConfig({
    unit: 'echo No tests',
    unit_cover: 'echo No tests'
  });

  grunt.loadNpmTasks('grunt-fh-build');
  grunt.registerTask('default', ['fh:default']);

  // override plato:fh since our sources are not in the lib directory
  grunt.config('plato', {
    fh: {
      files: {
        plato: ['*.js']
      }
    }
  });

};
