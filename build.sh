docker build --target base -t toolhub-twylt:base .
docker build --target git  -t toolhub-twylt:git .
docker build --target docs -t toolhub-twylt:docs .
docker build --target hdl  -t toolhub-twylt:hdl .
docker build --target docsanity -t toolhub-twylt:docsanity .
