# ARLAS Web Contributors

[![Build Status](https://travis-ci.org/gisaia/ARLAS-web-contributors.svg?branch=develop)](https://travis-ci.org/gisaia/ARLAS-web-contributors)
[![npm version](https://badge.fury.io/js/arlas-web-contributors.svg)](https://badge.fury.io/js/arlas-web-contributors)

`arlas-web-contributors` is a typescript library that fetches data from the [ARLAS Exploration API](http://docs.arlas.io/arlas-tech/current/arlas-api-exploration/) and pass it to the different [arlas-web-components](https://github.com/gisaia/ARLAS-web-components).

Each ARLAS-web-component has its corresponding contributor. 

A contributor also listens to the filters applied on the component and pass them to the other contributors. These collaborative contibutions are monitored by [arlas-web-core](https://github.com/gisaia/ARLAS-web-core)

## Install

To install this library in your npm web application, add the dependency in your `package.json` file.

```shell
$ npm install --save arlas-web-contributors
```

## Documentation

Please find the documentation of all the contributors [here](http://docs.arlas.io/arlas-tech/current/classes/_contributors_treecontributor_.treecontributor/)

## Build

To build the project you need to have installed
- [Node](https://nodejs.org/en/) version >= 8.0.0 
- [npm](https://github.com/npm/npm) version >= 5.2.0

Then, clone the project

```shell
$ git clone https://github.com/gisaia/ARLAS-web-contributors
```

Move to the folder

```shell
$ cd ARLAS-web-contributors
```

Install all the project's dependencies

```shell
$ npm install
```

Build the project with `tsc` and `gulp` :

```shell
$ npm run build-release
```

The build artifacts will be generated in the `dist/` directory. 

## Contributing

Please read [CONTRIBUTING.md](https://github.com/gisaia/ARLAS-web-contributors/blob/master/CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests to us.

## Versioning

We use [SemVer](http://semver.org/) for versioning : `x.y.z`.

- `x` : Incremented as soon as the `ARLAS-server API` changes
- `y` : Incremented as soon as a contributor has a new feature or a new contributor is implemented.
- `z` : Incremented as soon as the `ARLAS-web-contributors` implementation receives a fix or an enhancement.


 For the versions available, check the [ARLAS-web-contributors releases](https://github.com/gisaia/ARLAS-web-contributors/releases). 

## Authors

* **Gisaïa** - *Initial work* - [Gisaïa](http://gisaia.fr/)

See also the list of [contributors](https://github.com/gisaia/ARLAS-web-contributors/graphs/contributors) who participated in this project.


## License

This project is licensed under the Apache License 2.0 - see the [LICENSE.txt](LICENSE.txt) file for details
