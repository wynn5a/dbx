<script setup lang="ts">
import { computed } from "vue";
import { Database } from "@lucide/vue";

const props = defineProps<{
  dbType: string;
}>();

const assetIcons: Record<string, string> = {
  mysql: "mysql",
  postgres: "postgres",
  postgresql: "postgres",
  sqlite: "sqlite",
  rqlite: "rqlite.png",
  redis: "redis",
  mongodb: "mongodb",
  clickhouse: "clickhouse",
  duckdb: "duckdb",
  mariadb: "mariadb",
  tidb: "tidb",
  elasticsearch: "elasticsearch",
  oracle: "oracle",
  "oracle-10g": "oracle",
  "oracle-legacy": "oracle",
  oracle_10g: "oracle",
  oracle_legacy: "oracle",
  sqlserver: "sqlserver",
  access: "access.png",
  oceanbase: "oceanbase",
  opengauss: "opengauss",
  gaussdb: "gaussdb",
  kwdb: "kwdb",
  kingbase: "kingbase",
  highgo: "highgo.png",
  goldendb: "goldendb.png",
  databend: "databend",
  vastbase: "vastbase.png",
  yashandb: "yashandb.png",
  snowflake: "snowflake",
  h2: "h2",
  dm: "dm",
  dameng: "dm",
  presto: "presto",
  hive: "hive",
  apache_kylin: "apache_kylin",
  sundb: "sundb",
  trino: "presto",
  kylin: "apache_kylin",
  cockroachdb: "cockroachdb",
  db2: "db2",
  bigquery: "bigquery",
  cassandra: "cassandra",
  doris: "doris",
  selectdb: "selectdb",
  tdengine: "tdengine",
  starrocks: "starrocks",
  redshift: "redshift",
  neo4j: "neo4j",
  informix: "informix",
  databricks: "databricks.webp",
  saphana: "saphana.webp",
  teradata: "teradata.webp",
  vertica: "vertica.webp",
  firebird: "firebird.webp",
  exasol: "exasol.webp",
  gbase: "gbase.webp",
  gbase8s: "gbase.webp",
  tdsql: "tdsql.webp",
  polardb: "polardb.webp",
  greatsql: "greatsql.webp",
  xugu: "xugu.png",
  iotdb: "iotdb",
  etcd: "etcd",
  iris: "iris.png",
};

const normalizedType = computed(() => props.dbType.toLowerCase().replace(/[\s-]+/g, "_"));
const assetName = computed(() => assetIcons[normalizedType.value]);
const assetSrc = computed(() => {
  if (!assetName.value) return "";
  return assetName.value.includes(".")
    ? `/icons/database/${assetName.value}`
    : `/icons/database/${assetName.value}.svg`;
});
</script>

<template>
  <img v-if="assetName" :src="assetSrc" alt="" class="database-logo object-contain" aria-hidden="true" />
  <Database v-else class="text-blue-400" />
</template>

<style scoped>
.database-logo {
  transform: scale(1.35);
  transform-origin: center;
}
</style>
