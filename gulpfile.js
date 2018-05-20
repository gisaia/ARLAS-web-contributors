const gulp = require('gulp');
const gulpClean = require('gulp-clean');
const gulpRunSequence = require('run-sequence');
const inlineResources = require('./tools/inline-resources');


const PROJECT_ROOT = process.cwd();

function inlineResource() {
    inlineResources('./dist/**');
}

gulp.task('copy-data', function() {
  return gulp.src('./src/**/*.json')
    .pipe(gulp.dest('dist/'));
});

function copyDts() {
    gulp.src('src/**/*.d.ts')
        .pipe(gulp.dest('./dist'));
}

function cleanDistNodeModules(){
    gulp.src('dist/node_modules')
        .pipe(gulpClean(null));
}

function cleanDistSrc(){
    gulp.src('dist/src')
        .pipe(gulpClean(null));
}

gulp.task('build:clean-dist-node_modules', cleanDistNodeModules);
gulp.task('build:clean-dist-src', cleanDistSrc);
gulp.task('build:copy-and-inline-dts', copyDts);
gulp.task('build:copy-resources', ['copy-data']);
gulp.task('build:release', function (done) {
    // Synchronously run those tasks.
    return gulpRunSequence(
        'build:clean-dist-node_modules',
        'build:clean-dist-src',
        'build:copy-and-inline-dts',
        'build:copy-resources',
        done
    );
});

gulp.task('default',['build:release']);
