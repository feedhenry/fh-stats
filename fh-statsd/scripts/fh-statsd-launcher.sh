#!/bin/bash
#
# Special helper script to be used in conjunction with /etc/init.d/fh-statsd
# to ensure log output (sent to stdout,stderr) from a daemonized script is accessible.
umask 002
exec $PS_BIN $* > $PS_CON 2>&1
