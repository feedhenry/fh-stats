//https://github.com/feedhenry/fh-pipeline-library

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
    }

    dir('fh-top') {
        stage('Install Dependencies') {
            npmInstall {}
        }

        stage('Build') {
            gruntBuild {
                name = 'fh-top'
            }
        }
    }
}
