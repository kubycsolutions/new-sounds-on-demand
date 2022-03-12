: Launch a local DynamoDB service, assuming that you've put it where I did.
set ddb_path=%HOMEPATH%\DynamoDbLocal
start /min java -Djava.library.path=%ddb_path%\DynamoDBLocal_lib -jar %ddb_path%\DynamoDBLocal.jar -sharedDb
