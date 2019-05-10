/*
 * Copyright 2017, OpenRemote Inc.
 *
 * See the CONTRIBUTORS.txt file in the distribution for a
 * full listing of individual contributors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */
package org.openremote.model.query.filter;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import org.openremote.model.value.ObjectValue;

@JsonSubTypes({
    @JsonSubTypes.Type(value = StringPredicate.class, name = StringPredicate.name),
    @JsonSubTypes.Type(value = BooleanPredicate.class, name = BooleanPredicate.name),
    @JsonSubTypes.Type(value = StringArrayPredicate.class, name = StringArrayPredicate.name),
    @JsonSubTypes.Type(value = DateTimePredicate.class, name = DateTimePredicate.name),
    @JsonSubTypes.Type(value = NumberPredicate.class, name = NumberPredicate.name),
    @JsonSubTypes.Type(value = RadialGeofencePredicate.class, name = RadialGeofencePredicate.name),
    @JsonSubTypes.Type(value = RectangularGeofencePredicate.class, name = RectangularGeofencePredicate.name),
    @JsonSubTypes.Type(value = ObjectValueKeyPredicate.class, name = ObjectValueKeyPredicate.name),
    @JsonSubTypes.Type(value = ValueEmptyPredicate.class, name = ValueEmptyPredicate.name),
    @JsonSubTypes.Type(value = ValueNotEmptyPredicate.class, name = ValueNotEmptyPredicate.name)
})
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    property = "predicateType"
)
public interface ValuePredicate {

    ObjectValue toModelValue();
}
