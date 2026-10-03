_E ?= default.env

include $(_E)
export $(shell sed 's/=.*//' $(_E))

.PHONY: show-env
show-env:
	env
