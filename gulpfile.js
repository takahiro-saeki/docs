/*
Copyright (c) 2015 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

'use strict';

// let gulp = require('gulp');
let gulp = require('gulp-help')(require('gulp'));
let $ = require('gulp-load-plugins')();
let matter = require('gulp-gray-matter');
let styleMod = require('gulp-style-modules');

let argv = require('yargs').argv;
let browserSync = require('browser-sync').create();
let del = require('del');
let fs = require('fs');
let marked = require('marked');
let merge = require('merge-stream');
let path = require('path');
let runSequence = require('run-sequence');
let toc = require('toc');

let AUTOPREFIXER_BROWSERS = ['last 2 versions', 'ios 8', 'Safari 8'];

marked.setOptions({
  highlight: code => {
    return require('highlight.js').highlightAuto(code).value;
  }
});

function minifyHtml() {
  return $.minifyHtml({quotes: true, empty: true, spare: true});
}

function uglifyJS() {
  return $.uglify({preserveComments: 'some'});
}

function license() {
  return $.license('BSD2', {
    organization: 'The Polymer Project Authors. All rights reserved.',
    tiny: true
  });
}

// reload is a noop unless '--reload' cmd line arg is specified.
let reload = function() {
  return new require('stream').PassThrough({objectMode: true});
}

if (argv.reload) {
  reload = browserSync.reload;
}

function createReloadServer() {
  browserSync.init({
    notify: true,
    open: !!argv.open,
    proxy: 'localhost:8080' // proxy serving through app engine.
  });
}

gulp.task('style', 'Compile sass, autoprefix, and minify CSS', function() {
  let sassOpts = {
    precision: 10,
    outputStyle: 'expanded',
    onError: console.error.bind(console, 'Sass error:')
  };

  return gulp.src('app/sass/**/*.scss')
    .pipe($.changed('dist/css'))
    .pipe($.sass(sassOpts))
    .pipe($.autoprefixer(AUTOPREFIXER_BROWSERS))
    // .pipe(styleMod()) // Wrap CSS in Polymer style module
    // .pipe(gulp.dest('app/css')) // Save unminimized css to dev directory.
    .pipe($.cssmin()) // Minify and add license
    .pipe(license())
    .pipe(gulp.dest('dist/css'))
});

gulp.task('style:modules', 'Wrap CSS in Polymer style modules', function() {
  return gulp.src('node_modules/highlight.js/styles/github.css')
    .pipe($.rename({basename: 'syntax-color'}))
    .pipe($.autoprefixer(AUTOPREFIXER_BROWSERS))
    .pipe(styleMod({
      //filename: 'syntax-color',
      // moduleId: function(file) {
      //   return 'syntax-color';//path.basename(file.path, path.extname(file.path)) + '-css';
      // }
    }))
    .pipe(gulp.dest('dist/css'))
});

gulp.task('images', 'Optimize images', function() {
  return gulp.src('app/images/**/*')
    .pipe($.changed('dist/images'))
    .pipe($.imagemin({
      progressive: true,
      interlaced: true,
      svgoPlugins: [{convertTransform: false}]
    }))
    .pipe(gulp.dest('dist/images'));
});

gulp.task('md', 'Markdown -> HTML conversion. Syntax highlight and TOC generation', function() {
  return gulp.src([
      'app/**/*.md',
      '!app/{bower_components,elements,images,js,sass}/**',
    ], {base: 'app/'})
    .pipe(matter(function(file) { // pull out front matter data.
      let data = file.data;
      data.file = file;
      data.content = marked(file.content); // Markdown -> HTML.
      data.title = data.title || '';
      data.link = data.link || '';

      data.content = toc.process(data.content, {
        header: '<h<%= level %><%= attrs %> id="<%= anchor %>" class="has-permalink"><%= header %></h<%= level %>>',
        TOC: '<details id="toc"><summary>Table of contents</summary><%= toc %></details>',
        tocMax: 3
      });

      $.util.replaceExtension(file, '.html'); // file.md -> file.html

      let tmpl = fs.readFileSync('templates/page.template');
      let renderTemplate = $.util.template(tmpl);

      return renderTemplate(data);
    }))
    .pipe($.rename({extname: '.html'}))
    .pipe(gulp.dest('dist'));
});

// // Minify html
// gulp.task('html', function() {
//   gulp.src('app/index.html')
//     //.pipe($.changed('dist/index.html'))
//     .pipe(minifyHtml())
//     .pipe(gulp.dest('dist'));
// });

gulp.task('jshint', 'Lint JS', function() {
  return gulp.src([
      'gruntfile.js',
      'app/js/**/*.js',
      'app/elements/**/*.js',
      'app/elements/**/*.html'
    ])
    .pipe($.changed('dist/js'))
    .pipe($.jshint.extract()) // Extract JS from .html files
    .pipe($.jshint({esnext: true}))
    .pipe($.jshint.reporter('jshint-stylish'))
    .pipe($.if(!browserSync.active, $.jshint.reporter('fail')));
});

gulp.task('js', 'Minify JS to dist/', ['jshint'], function() {
  return gulp.src(['app/js/**/*.js'])
    .pipe(uglifyJS()) // Minify js output
    .pipe(gulp.dest('dist/js'));
});

gulp.task('vulcanize', 'Vulcanize elements to dist/', function() {
  return gulp.src('app/elements/elements.html')
    // .pipe($.changed('dist/elements'))
    .pipe($.vulcanize({
      stripComments: true,
      inlineCss: true,
      inlineScripts: true
    }))
    .pipe($.crisper()) // Separate HTML/JS into separate files.
    .pipe($.if('*.html', minifyHtml())) // Minify html output
    .pipe($.if('*.js', uglifyJS())) // Minify js output
    .pipe($.if('*.js', license()))
    .pipe(gulp.dest('dist/elements'));
});

gulp.task('copy', 'Copy site files (polyfills, templates, etc.) to dist/', function() {
  let app = gulp.src([
      '*',
      'app/manifest.json',
      '!{README.md, package.json,gulpfile.js}',
    ], {nodir: true})
    .pipe(gulp.dest('dist'));

  let docs = gulp.src([
      'app/**/*.html'
     ], {base: 'app/'})
    .pipe(gulp.dest('dist'));

  let gae = gulp.src([
      '{templates,lib,tests}/**/*'
     ])
    .pipe(gulp.dest('dist'));

  let bower = gulp.src([
      'app/bower_components/webcomponentsjs/webcomponents*.js'
    ], {base: 'app/'})
    .pipe(gulp.dest('dist'));

  return merge(app, docs, gae, bower);
});

gulp.task('watch', 'Watch files for changes', function() {
  createReloadServer();
  gulp.watch('app/sass/**/*.scss', ['style', reload]);
  gulp.watch('app/elements/**/*', ['vulcanize', reload]);
  gulp.watch(['app/{js,elements}/**/*.js'], ['jshint', reload]);
  gulp.watch('app/**/*.md', ['md', reload]);
  gulp.watch(['templates/*.html', 'app/**/*.html'], ['copy', reload]);
  // Watch for changes to server itself.
  gulp.watch('*.py', function(files) {
    gulp.src('*.py').pipe(gulp.dest('dist'));
    reload();
  });
  gulp.watch('*.{yaml,yml}', function(files) {
    gulp.src('*.{yml,yaml}').pipe(gulp.dest('dist'));
    reload();
  });
}, {
  options: {
    'reload': 'Reloads browser tab when watched files change',
    'open': 'Opens a browser tab when launched'
  }
});

gulp.task('clean', 'Remove dist/ and other built files', function() {
  return del(['dist', 'app/css']);
});

// Default task. Build the dest dir.
gulp.task('default', 'Build site', ['clean', 'jshint'], function(done) {
  runSequence(
    ['style', 'style:modules', 'images', 'vulcanize', 'js'],
    'copy', 'md',
    done);
});
