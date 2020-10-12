SELECT service_id,petition_id,service_description,logo_uri,service_name,integration_environment,CASE WHEN owned IS NULL THEN false ELSE owned END,status,type,state,CASE WHEN group_manager IS NULL then false ELSE group_manager END,CASE WHEN notification IS NULL THEN false ELSE notification END AS notification,deleted,comment,group_id
FROM
  (SELECT id AS service_id,service_description,logo_uri,service_name,deleted,requester,integration_environment,group_id FROM service_details WHERE tenant=${tenant_name}) AS service_details LEFT JOIN service_state ON service_details.service_id=service_state.id LEFT JOIN
  (SELECT id AS group_id,true AS owned,CASE WHEN group_manager IS NULL then false ELSE group_manager END FROM groups LEFT JOIN group_subs ON groups.id=group_subs.group_id WHERE sub=${sub}) AS group_ids
  USING (group_id)
  LEFT JOIN (SELECT id AS petition_id,status,type,CASE WHEN service_petition_details.comment IS NOT NULL THEN true ELSE false END AS notification, service_id,comment
    FROM service_petition_details WHERE reviewed_at IS NULL) AS petitions USING (service_id)
WHERE deleted=false OR (deleted=TRUE AND state!='deployed')
UNION
SELECT service_id,petition_id,service_description,logo_uri,service_name,integration_environment,CASE WHEN group_subs.sub=${sub} THEN true ELSE false END AS owned,status,type,state,CASE WHEN group_manager IS NULL THEN false ELSE group_manager END,notification,deleted,comment,petitions.group_id
  FROM
  (SELECT service_id,id AS petition_id,comment,service_description,logo_uri,service_name,integration_environment,CASE WHEN service_petition_details.comment IS NOT NULL THEN true ELSE false END AS notification,status,type,null AS state,false AS deleted,group_id
  FROM service_petition_details WHERE reviewed_at IS NULL AND type='create' AND tenant=${tenant_name}) as petitions LEFT JOIN group_subs ON petitions.group_id= group_subs.group_id AND group_subs.sub=${sub}