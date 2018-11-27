const gulp = require('gulp');

function copyDts() {
    return gulp.src('src/**/*.d.ts')
        .pipe(gulp.dest('./dist'));
}

function copyData() {
    return gulp.src('./src/**/*.json')
      .pipe(gulp.dest('dist/'));
  };

gulp.task('build:copy-and-inline-dts', copyDts,function(done){done()});
gulp.task('build:copy-resources', copyData,function(done){done()});
gulp.task('default', 
gulp.series('build:copy-and-inline-dts','build:copy-resources'),function(done){done()});
