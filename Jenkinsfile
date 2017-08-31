#!groovy

// https://github.com/feedhenry/fh-pipeline-library
@Library('fh-pipeline-library') _

fhBuildNode([labels: ['nodejs6-ubuntu']]) {
    dir('fh-statsd') {
        stage('Install Dependencies') {
            npmInstall {}
        }

        stage('Build') {
            gruntBuild {
                name = 'fh-stats'
            }
        }
    }
}
