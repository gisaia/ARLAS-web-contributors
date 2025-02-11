#!/bin/sh -e

## CREATE TARGET DIRECTORY ##
rm -rf target
mkdir target
mkdir target/generated-docs

## GENERATE THE DOCUMENTATION ##
docker run -a STDERR --rm -i -v `pwd`:/docs gisaia/typedocgen:0.0.10 generatedoc src

## MOVE ALL THE DOCUMENTATION TO THE 'generated-docs' FOLDER ##
mv typedoc_docs/* target/generated-docs
cp CHANGELOG.md target/generated-docs/CHANGELOG_ARLAS-web-contributors.md
if [ -d ./docs ] ; then
    cp -r docs/* target/generated-docs
fi

