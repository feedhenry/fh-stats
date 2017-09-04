#!groovy

// https://github.com/feedhenry/fh-pipeline-library
@Library('fh-pipeline-library') _

fhBuildNode {
    dir('fh-statsd') {
        stage('Install Dependencies') {
            npmInstall {}
        }

        stage('Build') {
            gruntBuild {
                name = 'fh-stats'
            }
        }

        stage('Build Image') {
            dockerBuildNodeComponent("fh-statsd")
        }
    }
}
