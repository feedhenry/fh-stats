#!groovy

// https://github.com/feedhenry/fh-pipeline-library
@Library('fh-pipeline-library') _

stage('Trust') {
    enforceTrustedApproval()
}

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

        stage('Build Image') {
            dockerBuildNodeComponent("fh-statsd")
        }
    }
}
